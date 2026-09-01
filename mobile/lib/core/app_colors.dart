import 'package:flutter/material.dart';

import 'palettes.dart';
import 'theme_controller.dart';

/// The colours of whichever theme is currently on.
///
/// These read through to the live palette rather than being constants, which
/// is what lets the ten website themes work at all — the trade is that nothing
/// using them can be `const`, and the analyzer enforces that for us.
///
/// The accent stays rare on purpose: it marks the single most important thing
/// on a screen, and a second thing wearing it makes the first one ordinary.
abstract final class AppColors {
  static LumaPalette get _p => ThemeController.instance.palette;

  static Color get brand => _p.brand;
  static Color get brandHover => _p.brandHover;
  /// Adaptive: the pale shade on dark themes, the solid one on light themes,
  /// so an accent on a card is legible under all ten palettes.
  static Color get brandLight => _p.accentOn(_p.bgSurface);

  /// The same choice, made against the floating nav pill's own ground.
  static Color get brandOnElevated => _p.accentOn(_p.bgElevated);
  static Color get onBrand => _p.onBrand;

  /// Translucent, so it tints whatever surface it sits on instead of fighting
  /// it — and so it survives a theme swap without a second value.
  static Color get brandTint => _p.brand.withValues(alpha: .14);

  static Color get bgApp => _p.bgApp;
  static Color get bgCanvas => _p.bgCanvas;
  static Color get bgSurface => _p.bgSurface;
  static Color get bgSurface2 => _p.bgSurface2;
  static Color get bgElevated => _p.bgElevated;

  static Color get textPrimary => _p.textPrimary;
  static Color get textSecondary => _p.textSecondary;
  static Color get textMuted => _p.textMuted;

  static Color get border => _p.border;
  static Color get borderStrong => _p.borderStrong;

  // Status colours are adjusted to stay readable on the current theme's cards.
  // See ReadableColour: the hue is the site's, the lightness is whatever it
  // takes to actually see it.
  static Color get danger => _readable(_p.danger);
  static Color get warning => _readable(_p.warning);
  static Color get info => _readable(_p.info);
  static Color get success => _readable(_p.success);
  static Color get purple => _readable(_p.purple);
  static Color get grey => _readable(_p.grey);

  static Color _readable(Color colour) => colour.readableOn(_p.bgSurface);
}
