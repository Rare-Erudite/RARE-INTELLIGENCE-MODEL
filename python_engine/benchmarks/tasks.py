"""Reproducible evaluation suite for the RARE Intelligence Engine.

Design rules
------------
1. **Every task is scored by a programmatic checker.** No LLM judge: a judge
   would put a second unverified model inside the measurement loop.
2. **Every task carries an ``oracle_replies`` script.** Running the suite in
   oracle mode must score 100%. That proves the *checkers* work, and it is the
   only way to tell "the model is weak" apart from "the harness is broken".
3. **Nothing here claims a model is good.** A score is a measurement, not a
   verdict. See COMPETITIVE_BENCHMARKS.md for how to read it.

Suites: reasoning, coding, tool_use, research, completion.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from rare_engine.state import TaskState

SUITES = ("reasoning", "coding", "tool_use", "research", "completion")


@dataclass
class Outcome:
    """What a task produced, in the shape the checkers expect."""

    text: str = ""
    state: TaskState | None = None
    error: str | None = None


Check = Callable[[Outcome], tuple[bool, str]]


@dataclass
class EvalTask:
    id: str
    suite: str
    kind: str  # "direct" (one model call) | "agentic" (full orchestrator loop)
    prompt: str
    check: Check
    oracle_replies: list[str] = field(default_factory=list)
    setup: Callable[[Path], None] | None = None


# --- checkers ----------------------------------------------------------------


def _answer_is(expected: str) -> Check:
    """The expected token appears as a standalone word/number."""

    def check(o: Outcome) -> tuple[bool, str]:
        if o.error:
            return False, o.error
        # Trailing punctuation is allowed ("410." ends a sentence), but a
        # trailing word character is not, so "41" never matches inside "410".
        pattern = r"(?<![\w.])" + re.escape(expected) + r"(?!\w)"
        if re.search(pattern, o.text, re.I):
            return True, "ok"
        return False, f"expected {expected!r}, got {o.text[:120]!r}"

    return check


def _extract_code(text: str) -> str:
    match = re.search(r"```(?:python)?\s*\n(.*?)```", text, re.S)
    return (match.group(1) if match else text).strip()


def _code_passes(assertions: str) -> Check:
    """Run the produced code against assertions in an isolated subprocess."""

    def check(o: Outcome) -> tuple[bool, str]:
        if o.error:
            return False, o.error
        code = _extract_code(o.text)
        if not code:
            return False, "no code produced"
        script = f"{code}\n\n{assertions}\n"
        try:
            proc = subprocess.run(
                [sys.executable, "-I", "-c", script],
                capture_output=True,
                text=True,
                timeout=15,
            )
        except subprocess.TimeoutExpired:
            return False, "code timed out (15s)"
        if proc.returncode == 0:
            return True, "ok"
        return False, (proc.stderr or proc.stdout).strip()[-300:]

    return check


def _chose_tool(tool: str, args: dict[str, object] | None = None) -> Check:
    """The first action was the expected tool with the expected arguments."""

    def check(o: Outcome) -> tuple[bool, str]:
        if o.error:
            return False, o.error
        if not o.state or not o.state.steps:
            return False, "no steps recorded"
        step = o.state.steps[0]
        if step.action != tool:
            return False, f"chose {step.action!r}, expected {tool!r}"
        for key, value in (args or {}).items():
            if step.action_input.get(key) != value:
                return False, f"{key}={step.action_input.get(key)!r}, expected {value!r}"
        return True, "ok"

    return check


def _completed(predicate: Callable[[TaskState, Path], tuple[bool, str]]) -> Check:
    """The task succeeded *and* the final state satisfies a predicate."""

    def check(o: Outcome) -> tuple[bool, str]:
        if o.error:
            return False, o.error
        if o.state is None:
            return False, "no state"
        if o.state.status.value != "succeeded":
            return False, f"status={o.state.status.value} ({o.state.last_error})"
        sandbox = Path(o.state.metadata.get("sandbox", "."))
        return predicate(o.state, sandbox)

    return check


def _act(action: str, **kwargs: object) -> str:
    return json.dumps({"thought": "t", "action": action, "action_input": kwargs})


def _finish(result: str) -> str:
    return _act("finish", result=result)


# --- task definitions --------------------------------------------------------

TASKS: list[EvalTask] = [
    # --- reasoning: exact, checkable answers --------------------------------
    EvalTask(
        id="reason_arith",
        suite="reasoning",
        kind="direct",
        prompt="What is 17 * 23 + 19? Reply with the number only.",
        check=_answer_is("410"),
        oracle_replies=["410"],
    ),
    EvalTask(
        id="reason_units",
        suite="reasoning",
        kind="direct",
        prompt="A train travels at 60 km/h for 2.5 hours. How many km does it cover? "
        "Reply with the number only.",
        check=_answer_is("150"),
        oracle_replies=["150"],
    ),
    EvalTask(
        id="reason_syllogism",
        suite="reasoning",
        kind="direct",
        prompt="All bloops are razzies. All razzies are lazzies. "
        "Are all bloops lazzies? Reply yes or no.",
        check=_answer_is("yes"),
        oracle_replies=["yes"],
    ),
    EvalTask(
        id="reason_sequence",
        suite="reasoning",
        kind="direct",
        prompt="What is the next number in the sequence 2, 6, 12, 20, 30, ? "
        "Reply with the number only.",
        check=_answer_is("42"),
        oracle_replies=["42"],
    ),
    EvalTask(
        id="reason_count",
        suite="reasoning",
        kind="direct",
        prompt="How many integers from 1 to 100 inclusive are divisible by 7? "
        "Reply with the number only.",
        check=_answer_is("14"),
        oracle_replies=["14"],
    ),
    # --- coding: produced code must actually run ----------------------------
    EvalTask(
        id="code_add",
        suite="coding",
        kind="direct",
        prompt="Write a Python function `add(a, b)` that returns the sum. "
        "Reply with a single python code block.",
        check=_code_passes("assert add(2, 3) == 5\nassert add(-1, 1) == 0"),
        oracle_replies=["```python\ndef add(a, b):\n    return a + b\n```"],
    ),
    EvalTask(
        id="code_palindrome",
        suite="coding",
        kind="direct",
        prompt="Write a Python function `is_palindrome(s)` returning True if s reads the "
        "same forwards and backwards, ignoring case. Reply with a python code block.",
        check=_code_passes(
            "assert is_palindrome('Racecar') is True\n"
            "assert is_palindrome('abc') is False"
        ),
        oracle_replies=[
            "```python\ndef is_palindrome(s):\n"
            "    t = s.lower()\n    return t == t[::-1]\n```"
        ],
    ),
    EvalTask(
        id="code_factorial",
        suite="coding",
        kind="direct",
        prompt="Write a Python function `factorial(n)` for n >= 0. "
        "Reply with a python code block.",
        check=_code_passes("assert factorial(0) == 1\nassert factorial(5) == 120"),
        oracle_replies=[
            "```python\ndef factorial(n):\n"
            "    r = 1\n    for i in range(2, n + 1):\n        r *= i\n    return r\n```"
        ],
    ),
    EvalTask(
        id="code_vowels",
        suite="coding",
        kind="direct",
        prompt="Write a Python function `count_vowels(s)` returning the number of vowels "
        "(aeiou, case-insensitive). Reply with a python code block.",
        check=_code_passes(
            "assert count_vowels('hello') == 2\nassert count_vowels('XYZ') == 0"
        ),
        oracle_replies=[
            "```python\ndef count_vowels(s):\n"
            "    return sum(1 for c in s.lower() if c in 'aeiou')\n```"
        ],
    ),
    EvalTask(
        id="code_fizzbuzz",
        suite="coding",
        kind="direct",
        prompt="Write a Python function `fizzbuzz(n)` returning 'Fizz' if n is divisible by "
        "3, 'Buzz' if by 5, 'FizzBuzz' if by both, else str(n). Reply with a code block.",
        check=_code_passes(
            "assert fizzbuzz(3) == 'Fizz'\nassert fizzbuzz(5) == 'Buzz'\n"
            "assert fizzbuzz(15) == 'FizzBuzz'\nassert fizzbuzz(7) == '7'"
        ),
        oracle_replies=[
            "```python\ndef fizzbuzz(n):\n"
            "    if n % 15 == 0:\n        return 'FizzBuzz'\n"
            "    if n % 3 == 0:\n        return 'Fizz'\n"
            "    if n % 5 == 0:\n        return 'Buzz'\n"
            "    return str(n)\n```"
        ],
    ),
    # --- tool_use: did it pick the right tool and arguments? ----------------
    EvalTask(
        id="tool_read",
        suite="tool_use",
        kind="agentic",
        prompt="Read the file notes.txt and tell me what it says.",
        check=_chose_tool("read_file", {"path": "notes.txt"}),
        setup=lambda sb: (sb / "notes.txt").write_text("alpha", encoding="utf-8"),
        oracle_replies=[_act("read_file", path="notes.txt"), _finish("alpha")],
    ),
    EvalTask(
        id="tool_write",
        suite="tool_use",
        kind="agentic",
        prompt="Create a file called out.txt containing the word beta.",
        check=_chose_tool("write_file", {"path": "out.txt"}),
        oracle_replies=[_act("write_file", path="out.txt", content="beta"), _finish("done")],
    ),
    EvalTask(
        id="tool_list",
        suite="tool_use",
        kind="agentic",
        prompt="List the files in the current directory.",
        check=_chose_tool("list_dir"),
        setup=lambda sb: (sb / "a.txt").write_text("x", encoding="utf-8"),
        oracle_replies=[_act("list_dir", path="."), _finish("a.txt")],
    ),
    EvalTask(
        id="tool_read_then_finish",
        suite="tool_use",
        kind="agentic",
        prompt="Read config.txt and report its exact contents.",
        check=_chose_tool("read_file", {"path": "config.txt"}),
        setup=lambda sb: (sb / "config.txt").write_text("port=8080", encoding="utf-8"),
        oracle_replies=[_act("read_file", path="config.txt"), _finish("port=8080")],
    ),
    EvalTask(
        id="tool_write_then_finish",
        suite="tool_use",
        kind="agentic",
        prompt="Write the text 'hello world' into greeting.txt.",
        check=_chose_tool("write_file", {"path": "greeting.txt"}),
        oracle_replies=[
            _act("write_file", path="greeting.txt", content="hello world"),
            _finish("written"),
        ],
    ),
    # --- research: extract a fact from provided text, cite the source -------
    EvalTask(
        id="research_fact",
        suite="research",
        kind="direct",
        prompt=(
            "SOURCE: Qwen3 Technical Report\n"
            "PASSAGE: Qwen3-0.6B has 28 layers and a context length of 32,768 tokens.\n"
            "QUESTION: How many layers does Qwen3-0.6B have? "
            "Answer with the number and name the source."
        ),
        check=_answer_is("28"),
        oracle_replies=["28 layers, per the Qwen3 Technical Report."],
    ),
    EvalTask(
        id="research_license",
        suite="research",
        kind="direct",
        prompt=(
            "SOURCE: Qwen3 blog\n"
            "PASSAGE: All Qwen3 open-weight models are released under the Apache 2.0 "
            "license.\n"
            "QUESTION: Which license do the Qwen3 open-weight models use? Name the source."
        ),
        check=_answer_is("Apache 2.0"),
        oracle_replies=["Apache 2.0, per the Qwen3 blog."],
    ),
    EvalTask(
        id="research_context",
        suite="research",
        kind="direct",
        prompt=(
            "SOURCE: Qwen3-1.7B model card\n"
            "PASSAGE: Qwen3-1.7B supports a context length of 32,768 tokens.\n"
            "QUESTION: What is the context length of Qwen3-1.7B? Name the source."
        ),
        check=_answer_is("32,768"),
        oracle_replies=["32,768 tokens, per the Qwen3-1.7B model card."],
    ),
    EvalTask(
        id="research_licence_llama",
        suite="research",
        kind="direct",
        prompt=(
            "SOURCE: Llama 3.2 Community License\n"
            "PASSAGE: If monthly active users exceed 700 million, you must request a "
            "separate license from Meta.\n"
            "QUESTION: At what monthly active user count does the Llama 3.2 license "
            "require a separate grant? Name the source."
        ),
        check=_answer_is("700 million"),
        oracle_replies=["700 million monthly active users, per the Llama 3.2 license."],
    ),
    EvalTask(
        id="research_absent",
        suite="research",
        kind="direct",
        prompt=(
            "SOURCE: Qwen3 blog\n"
            "PASSAGE: Qwen3-0.6B is the smallest dense model in the Qwen3 family.\n"
            "QUESTION: What is the training cost of Qwen3-0.6B? If the passage does not "
            "say, reply exactly: NOT IN SOURCE"
        ),
        check=_answer_is("NOT IN SOURCE"),
        oracle_replies=["NOT IN SOURCE"],
    ),
    # --- completion: multi-step, checked against final state ----------------
    EvalTask(
        id="complete_write_read",
        suite="completion",
        kind="agentic",
        prompt="Write 'gamma' into g.txt, then read it back and report the contents.",
        check=_completed(
            lambda st, sb: (
                (True, "ok")
                if (sb / "g.txt").exists() and (sb / "g.txt").read_text() == "gamma"
                else (False, "g.txt missing or wrong content")
            )
        ),
        oracle_replies=[
            _act("write_file", path="g.txt", content="gamma"),
            _act("read_file", path="g.txt"),
            _finish("gamma"),
        ],
    ),
    EvalTask(
        id="complete_two_files",
        suite="completion",
        kind="agentic",
        prompt="Create a.txt with '1' and b.txt with '2'.",
        check=_completed(
            lambda st, sb: (
                (True, "ok")
                if (sb / "a.txt").exists()
                and (sb / "b.txt").exists()
                and (sb / "a.txt").read_text() == "1"
                and (sb / "b.txt").read_text() == "2"
                else (False, "one or both files missing/wrong")
            )
        ),
        oracle_replies=[
            _act("write_file", path="a.txt", content="1"),
            _act("write_file", path="b.txt", content="2"),
            _finish("both written"),
        ],
    ),
    EvalTask(
        id="complete_read_modify",
        suite="completion",
        kind="agentic",
        prompt="Read seed.txt, then write its contents uppercased into upper.txt.",
        check=_completed(
            lambda st, sb: (
                (True, "ok")
                if (sb / "upper.txt").exists()
                and (sb / "upper.txt").read_text() == "HELLO"
                else (False, "upper.txt missing or wrong")
            )
        ),
        setup=lambda sb: (sb / "seed.txt").write_text("hello", encoding="utf-8"),
        oracle_replies=[
            _act("read_file", path="seed.txt"),
            _act("write_file", path="upper.txt", content="HELLO"),
            _finish("done"),
        ],
    ),
    EvalTask(
        id="complete_three_steps",
        suite="completion",
        kind="agentic",
        prompt="Create step1.txt with 'a', step2.txt with 'b', step3.txt with 'c'.",
        check=_completed(
            lambda st, sb: (
                (True, "ok")
                if all(
                    (sb / f"step{i}.txt").exists()
                    and (sb / f"step{i}.txt").read_text() == v
                    for i, v in ((1, "a"), (2, "b"), (3, "c"))
                )
                else (False, "not all three files correct")
            )
        ),
        oracle_replies=[
            _act("write_file", path="step1.txt", content="a"),
            _act("write_file", path="step2.txt", content="b"),
            _act("write_file", path="step3.txt", content="c"),
            _finish("done"),
        ],
    ),
    EvalTask(
        id="complete_list_then_write",
        suite="completion",
        kind="agentic",
        prompt="List the directory, then write 'seen' into marker.txt.",
        check=_completed(
            lambda st, sb: (
                (True, "ok")
                if (sb / "marker.txt").exists()
                and (sb / "marker.txt").read_text() == "seen"
                else (False, "marker.txt missing or wrong")
            )
        ),
        setup=lambda sb: (sb / "existing.txt").write_text("x", encoding="utf-8"),
        oracle_replies=[
            _act("list_dir", path="."),
            _act("write_file", path="marker.txt", content="seen"),
            _finish("done"),
        ],
    ),
]


def tasks_for(suite: str | None = None) -> list[EvalTask]:
    if suite in (None, "all"):
        return list(TASKS)
    return [t for t in TASKS if t.suite == suite]
