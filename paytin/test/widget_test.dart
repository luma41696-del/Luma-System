import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:paytin/app.dart';
import 'package:paytin/features/shell/app_shell.dart';
import 'package:paytin/features/statistics/statistics_screen.dart';

void main() {
  testWidgets('onboarding leads into the app shell', (tester) async {
    await tester.pumpWidget(const PaytinApp());

    expect(find.text('Digital Banking'), findsOneWidget);
    expect(find.text("Let's Start"), findsOneWidget);

    await tester.tap(find.text("Let's Start"));
    await tester.pumpAndSettle();

    expect(find.byType(AppShell), findsOneWidget);
    expect(find.text('Welcome Back 👋'), findsOneWidget);
  });

  testWidgets('bottom nav switches to the statistics screen', (tester) async {
    await tester.pumpWidget(const PaytinApp());
    await tester.tap(find.text('Skip'));
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.bar_chart_rounded));
    await tester.pumpAndSettle();

    expect(find.byType(StatisticsScreen), findsOneWidget);
    expect(find.text('Statistics'), findsOneWidget);
    expect(find.text('Overview'), findsOneWidget);
  });
}
