import 'package:flutter/material.dart';

/// The palette from the Paytin design, carried over to Luma.
///
/// The design is built on one loud accent against near-black, with everything
/// else kept quiet. That only works if the accent stays rare — it marks the
/// single most important thing on a screen and nothing else, which is why
/// there is no "secondary" accent here to reach for.
abstract final class AppColors {
  static const lime = Color(0xFFC6EC4E);
  static const limeDark = Color(0xFFB4DB3C);
  static const limeSoft = Color(0xFFE4F2B4);
  static const limeTint = Color(0xFFEAF4D4);

  /// Used for the hero card, the nav pill and anything that should read as
  /// "the app itself" rather than content.
  static const ink = Color(0xFF1C1C1E);
  static const inkSoft = Color(0xFF2E2E30);

  static const scaffold = Color(0xFFF2F6EA);
  static const surface = Colors.white;

  static const textPrimary = Color(0xFF1B1B1B);
  static const textSecondary = Color(0xFF8B9082);
  static const textMuted = Color(0xFFA7AC9E);

  static const divider = Color(0xFFE7EBDD);

  // Status colours, matched to the web app's task statuses so the same work
  // looks the same on both screens.
  static const danger = Color(0xFFE5484D);
  static const warning = Color(0xFFE8A33D);
  static const info = Color(0xFF3B82F6);
  static const success = Color(0xFF2FA76B);
  static const purple = Color(0xFF8B5CF6);
  static const grey = Color(0xFF9AA08F);
}
