import 'package:flutter/material.dart';

import 'core/app_theme.dart';
import 'features/onboarding/onboarding_screen.dart';

class PaytinApp extends StatelessWidget {
  const PaytinApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Paytin',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: const OnboardingScreen(),
    );
  }
}
