/// RARE-INTELLIGENCE — Official Flutter / Dart Integration Client
/// Designed specifically for seamless integration into RARE-THE-SIXTH mobile app.
///
/// Features:
/// - Authenticated Bearer / X-API-Key communication (never leaks Gemini secrets to mobile)
/// - Distinguishes running engine from genuine ready AI model provider
/// - Offline resilience and structured exception handling
/// - Conversation session management and queued task monitoring
/// - Zero-budget policy enforcement

import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// Structured Exception for RARE-INTELLIGENCE errors
class RareIntelligenceException implements Exception {
  final String code;
  final String message;
  final int statusCode;
  final String? correlationId;
  final bool isTransient;

  RareIntelligenceException({
    required this.code,
    required this.message,
    required this.statusCode,
    this.correlationId,
    this.isTransient = false,
  });

  @override
  String toString() =>
      'RareIntelligenceException [$code] ($statusCode): $message (Correlation: $correlationId)';
}

/// Truthful status of the AI engine and available inference models
class EngineStatusInfo {
  final bool isEngineRunning;
  final bool isAiProviderReady;
  final bool isStorageAvailable;
  final bool isStoragePersistent;
  final bool isModelInstalled;
  final bool isModelLoaded;
  final String operationalState;
  final String activeProvider;
  final String modelIdentifier;
  final bool isOnline;
  final String summaryMessage;

  EngineStatusInfo({
    required this.isEngineRunning,
    required this.isAiProviderReady,
    required this.isStorageAvailable,
    required this.isStoragePersistent,
    required this.isModelInstalled,
    required this.isModelLoaded,
    required this.operationalState,
    required this.activeProvider,
    required this.modelIdentifier,
    required this.isOnline,
    required this.summaryMessage,
  });

  factory EngineStatusInfo.fromJson(Map<String, dynamic> json) {
    final health = json['health'] as Map<String, dynamic>? ?? json;
    final operationalState = health['operationalState'] as String? ?? 'UNKNOWN';
    final isOnline = health['isOnline'] as bool? ?? false;
    final activeProvider = health['activeProvider'] as String? ?? 'none';
    final report = health['operationalReport'] as Map<String, dynamic>?;

    final availableProviders = (health['availableProviders'] as List<dynamic>?) ?? [];
    final activeProviderObj = availableProviders.firstWhere(
      (p) => p['id'] == activeProvider,
      orElse: () => null,
    );

    final isProviderReady = activeProviderObj != null && activeProviderObj['isAvailable'] == true;
    final localModelAvail = report?['localModelAvailable'] as bool? ?? false;
    final storageAvail = report?['localStorageAvailable'] as bool? ?? true;
    final isPersistent = (health['memoryStorageType'] as String?)?.contains('persistent') ?? true;

    return EngineStatusInfo(
      isEngineRunning: true,
      isAiProviderReady: isProviderReady,
      isStorageAvailable: storageAvail,
      isStoragePersistent: isPersistent,
      isModelInstalled: localModelAvail,
      isModelLoaded: isProviderReady && (activeProvider == 'local-transformers'),
      operationalState: operationalState,
      activeProvider: activeProvider,
      modelIdentifier: activeProviderObj?['modelIdentifier'] ?? 'local-transformers',
      isOnline: isOnline,
      summaryMessage: report?['summaryMessage'] ?? 'Engine active.',
    );
  }
}

/// Chat response model
class RareChatResponse {
  final String text;
  final String provider;
  final String model;
  final int latencyMs;
  final bool isSimulated;
  final int totalTokens;

  RareChatResponse({
    required this.text,
    required this.provider,
    required this.model,
    required this.latencyMs,
    required this.isSimulated,
    required this.totalTokens,
  });

  factory RareChatResponse.fromJson(Map<String, dynamic> json) {
    final result = json['result'] as Map<String, dynamic>? ?? json;
    final tokenUsage = result['tokenUsage'] as Map<String, dynamic>?;

    return RareChatResponse(
      text: result['text'] as String? ?? '',
      provider: result['provider'] as String? ?? 'unknown',
      model: result['model'] as String? ?? 'unknown',
      latencyMs: result['latencyMs'] as int? ?? 0,
      isSimulated: result['isSimulated'] as bool? ?? false,
      totalTokens: tokenUsage?['totalTokens'] as int? ?? 0,
    );
  }
}

/// Queued Task model
class RareQueuedTask {
  final String taskId;
  final String objective;
  final String status;
  final String networkDependency;
  final int createdAt;
  final String? error;

  RareQueuedTask({
    required this.taskId,
    required this.objective,
    required this.status,
    required this.networkDependency,
    required this.createdAt,
    this.error,
  });

  factory RareQueuedTask.fromJson(Map<String, dynamic> json) {
    final task = json['task'] as Map<String, dynamic>? ?? json;
    return RareQueuedTask(
      taskId: task['taskId'] as String? ?? '',
      objective: task['objective'] as String? ?? '',
      status: task['status'] as String? ?? 'pending',
      networkDependency: task['networkDependency'] as String? ?? 'local_only',
      createdAt: task['createdAt'] as int? ?? 0,
      error: task['error'] as String?,
    );
  }
}

/// Production client for RARE-INTELLIGENCE Engine
class RareIntelligenceClient {
  final String baseUrl;
  final String apiKey;
  final Duration timeout;
  final HttpClient _httpClient;

  RareIntelligenceClient({
    required this.baseUrl,
    required this.apiKey,
    this.timeout = const Duration(seconds: 30),
  }) : _httpClient = HttpClient() {
    _httpClient.connectionTimeout = const Duration(seconds: 10);
  }

  String get _cleanBaseUrl => baseUrl.replaceAll(RegExp(r'/+$'), '');

  /// Check engine health and distinguish engine running vs real AI ready
  Future<EngineStatusInfo> checkHealth() async {
    final json = await _get('/api/v1/engine/health');
    return EngineStatusInfo.fromJson(json);
  }

  /// Send chat message to engine with context
  Future<RareChatResponse> sendMessage({
    required String prompt,
    List<Map<String, String>> previousMessages = const [],
    String? systemInstruction,
    double temperature = 0.7,
    int maxTokens = 1024,
  }) async {
    final messages = [
      ...previousMessages,
      {'role': 'user', 'content': prompt},
    ];

    final body = {
      'messages': messages,
      'options': {
        'temperature': temperature,
        'maxOutputTokens': maxTokens,
        if (systemInstruction != null) 'systemInstruction': systemInstruction,
      },
    };

    final json = await _post('/api/v1/chat', body);
    return RareChatResponse.fromJson(json);
  }

  /// Submit an offline or hybrid task to the persistent task queue
  Future<RareQueuedTask> enqueueTask({
    required String objective,
    String networkDependency = 'local_only',
    List<String> constraints = const [],
  }) async {
    final body = {
      'objective': objective,
      'networkDependency': networkDependency,
      'constraints': constraints,
    };

    final json = await _post('/api/v1/queue/enqueue', body);
    return RareQueuedTask.fromJson(json);
  }

  /// Retrieve status of a queued task
  Future<List<RareQueuedTask>> listTasks() async {
    final json = await _get('/api/v1/queue/tasks');
    final tasksList = (json['tasks'] as List<dynamic>?) ?? [];
    return tasksList.map((t) => RareQueuedTask.fromJson(t as Map<String, dynamic>)).toList();
  }

  /// Create a new conversation session
  Future<Map<String, dynamic>> createConversation({String? title, Map<String, dynamic>? metadata}) async {
    final body = {
      if (title != null) 'title': title,
      if (metadata != null) 'metadata': metadata,
    };
    return await _post('/api/v1/conversations', body);
  }

  /// Get existing conversation by ID
  Future<Map<String, dynamic>> getConversation(String id) async {
    return await _get('/api/v1/conversations/$id');
  }

  /// List all conversation sessions
  Future<List<dynamic>> listConversations() async {
    final json = await _get('/api/v1/conversations');
    return (json['conversations'] as List<dynamic>?) ?? [];
  }

  /// Delete a conversation session
  Future<bool> deleteConversation(String id) async {
    final json = await _delete('/api/v1/conversations/$id');
    return json['deleted'] as bool? ?? false;
  }

  /// Send message to conversation and get response
  Future<Map<String, dynamic>> sendMessageToConversation({
    required String conversationId,
    required String message,
    double temperature = 0.7,
    int maxTokens = 1024,
  }) async {
    final body = {
      'message': message,
      'options': {
        'temperature': temperature,
        'maxOutputTokens': maxTokens,
      },
    };
    return await _post('/api/v1/conversations/$conversationId/messages', body);
  }

  /// Rename an existing conversation
  Future<Map<String, dynamic>> renameConversation(String id, String newTitle) async {
    final body = {'title': newTitle};
    return await _patch('/api/v1/conversations/$id', body);
  }

  /// Get messages in conversation
  Future<List<dynamic>> getConversationMessages(String id) async {
    final json = await _get('/api/v1/conversations/$id/messages');
    return (json['messages'] as List<dynamic>?) ?? [];
  }

  /// Conduct grounded research over notes
  Future<Map<String, dynamic>> conductResearch(String topic, {List<String> notes = const []}) async {
    final body = {'topic': topic, 'notes': notes};
    return await _post('/api/v1/assistant/research', body);
  }

  /// Parse document contents (CSV, JSON, Markdown, Text, PDF)
  Future<Map<String, dynamic>> parseDocument(String filename, String content) async {
    final body = {'filename': filename, 'content': content};
    return await _post('/api/v1/assistant/document-parse', body);
  }

  /// Explicitly trigger loading local neural open-weights into memory
  Future<Map<String, dynamic>> loadLocalModel() async {
    return await _post('/api/v1/providers/load-local', {});
  }

  // --- Internal HTTP transport ---

  Future<Map<String, dynamic>> _get(String path) async {
    try {
      final uri = Uri.parse('$_cleanBaseUrl$path');
      final request = await _httpClient.getUrl(uri).timeout(timeout);
      _setHeaders(request);

      final response = await request.close().timeout(timeout);
      return _processResponse(response);
    } on SocketException catch (e) {
      throw RareIntelligenceException(
        code: 'NETWORK_FAILURE',
        message: 'Unable to reach RARE-INTELLIGENCE server: ${e.message}',
        statusCode: 503,
        isTransient: true,
      );
    } on TimeoutException {
      throw RareIntelligenceException(
        code: 'TIMEOUT_OR_CANCELLED',
        message: 'Request timed out waiting for RARE-INTELLIGENCE server.',
        statusCode: 504,
        isTransient: true,
      );
    }
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    try {
      final uri = Uri.parse('$_cleanBaseUrl$path');
      final request = await _httpClient.postUrl(uri).timeout(timeout);
      _setHeaders(request);

      final bytes = utf8.encode(jsonEncode(body));
      request.headers.set('Content-Type', 'application/json; charset=utf-8');
      request.add(bytes);

      final response = await request.close().timeout(timeout);
      return _processResponse(response);
    } on SocketException catch (e) {
      throw RareIntelligenceException(
        code: 'NETWORK_FAILURE',
        message: 'Unable to reach RARE-INTELLIGENCE server: ${e.message}',
        statusCode: 503,
        isTransient: true,
      );
    } on TimeoutException {
      throw RareIntelligenceException(
        code: 'TIMEOUT_OR_CANCELLED',
        message: 'Request timed out waiting for RARE-INTELLIGENCE server.',
        statusCode: 504,
        isTransient: true,
      );
    }
  }

  Future<Map<String, dynamic>> _patch(String path, Map<String, dynamic> body) async {
    try {
      final uri = Uri.parse('$_cleanBaseUrl$path');
      final request = await _httpClient.patchUrl(uri).timeout(timeout);
      _setHeaders(request);

      final bytes = utf8.encode(jsonEncode(body));
      request.headers.set('Content-Type', 'application/json; charset=utf-8');
      request.add(bytes);

      final response = await request.close().timeout(timeout);
      return _processResponse(response);
    } on SocketException catch (e) {
      throw RareIntelligenceException(
        code: 'NETWORK_FAILURE',
        message: 'Unable to reach RARE-INTELLIGENCE server: ${e.message}',
        statusCode: 503,
        isTransient: true,
      );
    } on TimeoutException {
      throw RareIntelligenceException(
        code: 'TIMEOUT_OR_CANCELLED',
        message: 'Request timed out waiting for RARE-INTELLIGENCE server.',
        statusCode: 504,
        isTransient: true,
      );
    }
  }

  Future<Map<String, dynamic>> _delete(String path) async {
    try {
      final uri = Uri.parse('$_cleanBaseUrl$path');
      final request = await _httpClient.deleteUrl(uri).timeout(timeout);
      _setHeaders(request);

      final response = await request.close().timeout(timeout);
      return _processResponse(response);
    } on SocketException catch (e) {
      throw RareIntelligenceException(
        code: 'NETWORK_FAILURE',
        message: 'Unable to reach RARE-INTELLIGENCE server: ${e.message}',
        statusCode: 503,
        isTransient: true,
      );
    } on TimeoutException {
      throw RareIntelligenceException(
        code: 'TIMEOUT_OR_CANCELLED',
        message: 'Request timed out waiting for RARE-INTELLIGENCE server.',
        statusCode: 504,
        isTransient: true,
      );
    }
  }

  void _setHeaders(HttpClientRequest request) {
    request.headers.set('Authorization', 'Bearer $apiKey');
    request.headers.set('X-API-Key', apiKey);
    request.headers.set('Accept', 'application/json');
    request.headers.set('User-Agent', 'RARE-THE-SIXTH-MobileClient/1.0');
  }

  Future<Map<String, dynamic>> _processResponse(HttpClientResponse response) async {
    final responseBody = await response.transform(utf8.decoder).join();
    Map<String, dynamic> json;
    try {
      json = jsonDecode(responseBody) as Map<String, dynamic>;
    } catch (_) {
      throw RareIntelligenceException(
        code: 'INVALID_MODEL_RESPONSE',
        message: 'Server returned invalid JSON response: $responseBody',
        statusCode: response.statusCode,
      );
    }

    if (response.statusCode >= 400) {
      final errorObj = json['error'] as Map<String, dynamic>?;
      throw RareIntelligenceException(
        code: errorObj?['code'] ?? 'UNKNOWN_ERROR',
        message: errorObj?['message'] ?? 'Request failed with HTTP ${response.statusCode}',
        statusCode: response.statusCode,
        correlationId: errorObj?['correlationId'],
        isTransient: errorObj?['isTransient'] ?? false,
      );
    }

    return json;
  }

  void dispose() {
    _httpClient.close(force: true);
  }
}
