import 'dart:convert';
import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Calls the same privileged backend the website calls.
///
/// Cloud Functions need the Blaze plan, so this deployment serves the callables
/// through a Netlify adapter instead. That adapter speaks the Firebase callable
/// protocol exactly — `{"data": …}` in, `{"result": …}` or `{"error": …}` out —
/// so one client works against either, and the `cloud_functions` package is not
/// used precisely because it would only ever reach the Firebase one.
///
/// The base URL is learned from the pairing QR rather than compiled in, and
/// remembered afterwards, so the app never asks anyone to type a server
/// address into a phone.
class LumaApi {
  LumaApi._();
  static final LumaApi instance = LumaApi._();

  static const _baseKey = 'luma.apiBase';

  String? _base;
  final _client = HttpClient();

  String? get base => _base;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _base = prefs.getString(_baseKey);
  }

  Future<void> setBase(String value) async {
    _base = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_baseKey, value);
  }

  Future<void> forget() async {
    _base = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_baseKey);
  }

  /// One call to a named callable.
  ///
  /// [overrideBase] exists for the pairing call, which happens before there is
  /// a stored base — the address comes from the code being scanned.
  Future<Map<String, dynamic>> call(
    String name, {
    Map<String, dynamic> payload = const {},
    String? overrideBase,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    final root = overrideBase ?? _base;
    if (root == null) {
      throw const ApiException('unavailable', 'لم يتم ربط التطبيق بالخادم بعد.');
    }

    final headers = <String, String>{'Content-Type': 'application/json'};
    final user = FirebaseAuth.instance.currentUser;
    if (user != null) {
      headers['Authorization'] = 'Bearer ${await user.getIdToken()}';
    }

    late HttpClientResponse response;
    late String body;
    try {
      final request = await _client
          .postUrl(Uri.parse('$root/$name'))
          .timeout(timeout);
      headers.forEach(request.headers.set);
      request.add(utf8.encode(jsonEncode({'data': payload})));

      response = await request.close().timeout(timeout);
      body = await response.transform(utf8.decoder).join();
    } on Object {
      throw const ApiException(
        'unavailable',
        'تعذّر الاتصال بالخادم. تحقق من الإنترنت.',
      );
    }

    Map<String, dynamic> parsed;
    try {
      parsed = jsonDecode(body) as Map<String, dynamic>;
    } on Object {
      throw const ApiException('internal', 'ردّ الخادم غير مفهوم.');
    }

    final error = parsed['error'];
    if (response.statusCode >= 400 || error is Map) {
      final map = error is Map ? error : const {};
      throw ApiException(
        _toCode(map['status']),
        (map['message'] as String?) ?? 'حدث خطأ في الخادم.',
      );
    }

    final result = parsed['result'];
    return result is Map<String, dynamic> ? result : <String, dynamic>{};
  }

  /// CALLABLE_STATUS -> the hyphenated codes used everywhere else.
  static String _toCode(Object? status) =>
      (status as String? ?? 'INTERNAL').toLowerCase().replaceAll('_', '-');
}

class ApiException implements Exception {
  const ApiException(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => message;
}
