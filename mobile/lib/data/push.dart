import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../core/firebase_options.dart';
import 'api.dart';

/// Handles a message that arrives while the app is not running.
///
/// This must be a top-level function: the system spins up a fresh Dart isolate
/// for it, with none of the app's state, so Firebase has to be started again
/// from scratch here.
///
/// Android already draws the notification itself for messages carrying a
/// `notification` block, so there is deliberately nothing to draw — this exists
/// so the isolate starts cleanly and any data payload can be handled later.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
}

/// Notifications, and the plumbing that keeps them working when the app is in
/// the background or closed.
class Push {
  Push._();
  static final Push instance = Push._();

  final _local = FlutterLocalNotificationsPlugin();

  /// A channel is required on Android 8+, and its importance is what decides
  /// whether a notification appears on screen or only in the shade.
  static const _channel = AndroidNotificationChannel(
    'luma_tasks',
    'مهام وإشعارات لوما',
    description: 'إشعارات المهام والرسائل والطلبات',
    importance: Importance.high,
  );

  /// Set when a notification opened the app, for the shell to act on once it
  /// has been built.
  String? pendingTaskId;

  Future<void> start() async {
    await _local.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
      onDidReceiveNotificationResponse: (response) {
        final taskId = response.payload;
        if (taskId != null && taskId.isNotEmpty) pendingTaskId = taskId;
      },
    );

    await _local
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_channel);

    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission();

    // iOS shows nothing while the app is open unless asked to.
    await messaging.setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );

    FirebaseMessaging.onMessage.listen(_showLocally);
    FirebaseMessaging.onMessageOpenedApp.listen(_remember);

    final opening = await messaging.getInitialMessage();
    if (opening != null) _remember(opening);

    await _registerToken();
    messaging.onTokenRefresh.listen((_) => _registerToken());
  }

  /// Tells the server where to reach this device. Failure is not fatal — the
  /// app is perfectly usable without push, so it must not block starting up.
  Future<void> _registerToken() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) return;
      await LumaApi.instance.call('registerPushToken', payload: {'token': token});
    } on Object catch (error) {
      debugPrint('[luma] could not register for notifications: $error');
    }
  }

  /// A foreground message is delivered silently by the system, so it is drawn
  /// here or it is not seen at all.
  Future<void> _showLocally(RemoteMessage message) async {
    final notification = message.notification;
    if (notification == null) return;

    await _local.show(
      id: notification.hashCode,
      title: notification.title,
      body: notification.body,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          _channel.id,
          _channel.name,
          channelDescription: _channel.description,
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: const DarwinNotificationDetails(),
      ),
      payload: message.data['taskId'] as String?,
    );
  }

  void _remember(RemoteMessage message) {
    final taskId = message.data['taskId'];
    if (taskId is String && taskId.isNotEmpty) pendingTaskId = taskId;
  }
}
