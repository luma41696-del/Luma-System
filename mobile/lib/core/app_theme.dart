import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'palettes.dart';

/// Radii from the Paytin design — cards there are closer to pills than to
/// rectangles, so the values are named rather than repeated as magic numbers.
abstract final class AppRadius {
  static const card = 28.0;
  static const tile = 20.0;
  static const chip = 999.0;
}

/// The website's Arabic face, bundled with the app so the two match.
const kFontFamily = 'DIN Next Arabic';

ThemeData buildAppTheme(LumaPalette palette) {
  final base = ThemeData(
    useMaterial3: true,
    brightness: palette.isDark ? Brightness.dark : Brightness.light,
    fontFamily: kFontFamily,
    colorScheme: ColorScheme.fromSeed(
      seedColor: palette.brand,
      brightness: palette.isDark ? Brightness.dark : Brightness.light,
      primary: palette.brand,
      onPrimary: palette.onBrand,
      surface: palette.bgSurface,
      onSurface: palette.textPrimary,
    ),
    scaffoldBackgroundColor: palette.bgApp,
    splashFactory: InkRipple.splashFactory,
  );

  return base.copyWith(
    textTheme: base.textTheme.apply(
      fontFamily: kFontFamily,
      bodyColor: palette.textPrimary,
      displayColor: palette.textPrimary,
    ),
    cardTheme: CardThemeData(
      color: palette.bgSurface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.card),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: palette.brand,
        foregroundColor: palette.onBrand,
        minimumSize: const Size.fromHeight(54),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.chip),
        ),
        textStyle: const TextStyle(
          fontFamily: kFontFamily,
          fontSize: 16,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
    dialogTheme: DialogThemeData(backgroundColor: palette.bgSurface),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: palette.bgCanvas),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: palette.brand),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: palette.bgSurface2,
      contentTextStyle: TextStyle(
        fontFamily: kFontFamily,
        color: palette.textPrimary,
      ),
    ),
    dividerTheme: DividerThemeData(
      color: palette.border,
      thickness: 1,
      space: 1,
    ),
    // Every screen pushed from a list slides in from the leading edge, which
    // in a right-to-left app means from the right. The default is fine on
    // Android; naming it keeps both platforms consistent.
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.android: CupertinoPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
      },
    ),
  );
}

/// A convenience for the odd place that wants the accent without importing
/// the palette type.
Color brandOf(BuildContext context) => AppColors.brand;
