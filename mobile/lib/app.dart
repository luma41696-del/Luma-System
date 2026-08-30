import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/app_theme.dart';
import 'data/session.dart';
import 'features/login/login_screen.dart';
import 'features/shell/app_shell.dart';

class LumaApp extends StatelessWidget {
  const LumaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'لوما',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      // Arabic throughout, which also puts the whole app in right-to-left —
      // Material reads the direction from the locale, so no screen has to ask
      // for it and none can forget to.
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const _AuthGate(),
    );
  }
}

/// Shows the app or the pairing screen, and moves between them without a jump.
class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Session.instance,
      builder: (context, _) {
        final signedIn = Session.instance.isSignedIn;
        return AnimatedSwitcher(
          duration: const Duration(milliseconds: 420),
          switchInCurve: Curves.easeOutCubic,
          switchOutCurve: Curves.easeIn,
          transitionBuilder: (child, animation) => FadeTransition(
            opacity: animation,
            child: ScaleTransition(
              scale: Tween(begin: .97, end: 1.0).animate(animation),
              child: child,
            ),
          ),
          child: signedIn
              ? const AppShell(key: ValueKey('shell'))
              : const LoginScreen(key: ValueKey('login')),
        );
      },
    );
  }
}
