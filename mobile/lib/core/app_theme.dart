import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Radii and spacing used across the app. The design leans on large radii —
/// cards are closer to pills than to rectangles — so these are worth naming
/// rather than repeating as magic numbers.
abstract final class AppRadius {
  static const card = 28.0;
  static const tile = 20.0;
  static const chip = 999.0;
}

ThemeData buildAppTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.lime,
      primary: AppColors.lime,
      onPrimary: AppColors.ink,
      surface: AppColors.scaffold,
    ),
    scaffoldBackgroundColor: AppColors.scaffold,
    splashFactory: InkRipple.splashFactory,
  );

  return base.copyWith(
    textTheme: base.textTheme.apply(
      bodyColor: AppColors.textPrimary,
      displayColor: AppColors.textPrimary,
      // Tabular figures would be wrong here: the app is Arabic, and the system
      // Arabic face already handles the digits.
      fontFamily: base.textTheme.bodyMedium?.fontFamily,
    ),
    cardTheme: CardThemeData(
      color: AppColors.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.card),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.ink,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(54),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.chip),
        ),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppColors.ink,
      contentTextStyle: TextStyle(color: Colors.white),
    ),
    dividerTheme: const DividerThemeData(
      color: AppColors.divider,
      thickness: 1,
      space: 1,
    ),
  );
}
