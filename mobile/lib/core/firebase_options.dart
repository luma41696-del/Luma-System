// Generated from the Firebase project's own registrations:
//   firebase apps:sdkconfig ANDROID|IOS --project luma-web-d3550
//
// These are public client identifiers, not credentials — the same values ship
// in google-services.json and in the web app's firebase-config.js. Access is
// controlled by Security Rules and custom claims, never by hiding these.

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError(
          'تطبيق لوما مبني لنظامي أندرويد و iOS فقط.',
        );
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyCQvpY9NMfHp70EBkvxlmc6ntty-AYJrfc',
    appId: '1:1005101836242:android:0feb9b7f5799ffc8c1ca0b',
    messagingSenderId: '1005101836242',
    projectId: 'luma-web-d3550',
    databaseURL: 'https://luma-web-d3550-default-rtdb.firebaseio.com',
    storageBucket: 'luma-web-d3550.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyCOTl4_N1bLPBLMJ5rhaxtLHCITUuXKrKg',
    appId: '1:1005101836242:ios:97379866bb6ff4fcc1ca0b',
    messagingSenderId: '1005101836242',
    projectId: 'luma-web-d3550',
    databaseURL: 'https://luma-web-d3550-default-rtdb.firebaseio.com',
    storageBucket: 'luma-web-d3550.firebasestorage.app',
    iosBundleId: 'com.lumaagency.luma',
  );
}
