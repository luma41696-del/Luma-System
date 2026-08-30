import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import 'app.dart';
import 'core/firebase_options.dart';
import 'data/api.dart';
import 'data/push.dart';
import 'data/session.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  // Registered before the first frame: a message can arrive while the app is
  // closed, and the handler has to already be known for the system to run it.
  FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

  // Which server this phone was paired to, remembered from the last launch.
  await LumaApi.instance.load();
  await Session.instance.start();

  runApp(const LumaApp());
}
