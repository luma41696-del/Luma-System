import 'dart:math' as math;

import 'package:flutter/material.dart';

/// The website's ten themes, taken from `css/variables.css`.
///
/// Two hundred colour values copied by hand would drift from the site within a
/// release, so these were extracted from the stylesheet itself and every
/// `var(--token)` chain was resolved first. If the site's palette changes,
/// re-run that extraction rather than editing values here.
@immutable
class LumaPalette {
  const LumaPalette({
    required this.id,
    required this.label,
    required this.icon,
    required this.isDark,
    required this.brand,
    required this.brandHover,
    required this.brandLight,
    required this.onBrand,
    required this.bgApp,
    required this.bgCanvas,
    required this.bgSurface,
    required this.bgSurface2,
    required this.bgElevated,
    required this.textPrimary,
    required this.textSecondary,
    required this.textMuted,
    required this.border,
    required this.borderStrong,
    required this.danger,
    required this.warning,
    required this.info,
    required this.success,
    required this.purple,
    required this.grey,
  });

  final String id;
  final String label;
  final IconData icon;

  /// Decides the status-bar icons and the keyboard's own colouring.
  final bool isDark;

  final Color brand;
  final Color brandHover;
  final Color brandLight;
  final Color onBrand;
  final Color bgApp;
  final Color bgCanvas;
  final Color bgSurface;
  final Color bgSurface2;
  final Color bgElevated;
  final Color textPrimary;
  final Color textSecondary;
  final Color textMuted;
  final Color border;
  final Color borderStrong;
  final Color danger;
  final Color warning;
  final Color info;
  final Color success;
  final Color purple;
  final Color grey;
}

const lumaPalettes = <LumaPalette>[
  LumaPalette(
    id: 'dark',
    label: 'داكن',
    icon: Icons.dark_mode,
    isDark: true,
    brand: Color(0xFF4070C8),
    brandHover: Color(0xFF355DAB),
    brandLight: Color(0xFF5C8AE0),
    onBrand: Color(0xFFFFFFFF),
    bgApp: Color(0xFF05121F),
    bgCanvas: Color(0xFF071A2F),
    bgSurface: Color(0xFF102943),
    bgSurface2: Color(0xFF16324F),
    bgElevated: Color(0xFF14314E),
    textPrimary: Color(0xFFF8FAFC),
    textSecondary: Color(0xFFD8DEE8),
    textMuted: Color(0xFF7F8998),
    border: Color(0xFF263B52),
    borderStrong: Color(0xFF34506E),
    danger: Color(0xFFF87171),
    warning: Color(0xFFFBBF24),
    info: Color(0xFF60A5FA),
    success: Color(0xFF34D399),
    purple: Color(0xFFA78BFA),
    grey: Color(0xFF7F8998),
  ),
  LumaPalette(
    id: 'light',
    label: 'فاتح',
    icon: Icons.light_mode,
    isDark: false,
    brand: Color(0xFF4070C8),
    brandHover: Color(0xFF355DAB),
    brandLight: Color(0xFF5C8AE0),
    onBrand: Color(0xFFFFFFFF),
    bgApp: Color(0xFFEEF1F6),
    bgCanvas: Color(0xFFF4F6FA),
    bgSurface: Color(0xFFFFFFFF),
    bgSurface2: Color(0xFFF7F9FC),
    bgElevated: Color(0xFFFFFFFF),
    textPrimary: Color(0xFF171B22),
    textSecondary: Color(0xFF41505F),
    textMuted: Color(0xFF7F8998),
    border: Color(0xFFE1E7F0),
    borderStrong: Color(0xFFC9D3E0),
    danger: Color(0xFFF87171),
    warning: Color(0xFFFBBF24),
    info: Color(0xFF60A5FA),
    success: Color(0xFF34D399),
    purple: Color(0xFFA78BFA),
    grey: Color(0xFF7F8998),
  ),
  LumaPalette(
    id: 'mono',
    label: 'أبيض وأسود',
    icon: Icons.contrast,
    isDark: false,
    brand: Color(0xFF141414),
    brandHover: Color(0xFF000000),
    brandLight: Color(0xFF3A3A3A),
    onBrand: Color(0xFFFFFFFF),
    bgApp: Color(0xFFF1F1F1),
    bgCanvas: Color(0xFFF7F7F7),
    bgSurface: Color(0xFFFFFFFF),
    bgSurface2: Color(0xFFF5F5F5),
    bgElevated: Color(0xFFFFFFFF),
    textPrimary: Color(0xFF111111),
    textSecondary: Color(0xFF444444),
    textMuted: Color(0xFF6E6E6E),
    border: Color(0xFFE3E3E3),
    borderStrong: Color(0xFFC9C9C9),
    danger: Color(0xFFC62828),
    warning: Color(0xFFA15C00),
    info: Color(0xFF1565C0),
    success: Color(0xFF1B7A43),
    purple: Color(0xFF6A3FB5),
    grey: Color(0xFF6E6E6E),
  ),
  LumaPalette(
    id: 'mono-dark',
    label: 'أسود وأبيض',
    icon: Icons.invert_colors,
    isDark: true,
    brand: Color(0xFFFFFFFF),
    brandHover: Color(0xFFD6D6D6),
    brandLight: Color(0xFFFFFFFF),
    onBrand: Color(0xFF000000),
    bgApp: Color(0xFF000000),
    bgCanvas: Color(0xFF080808),
    bgSurface: Color(0xFF121212),
    bgSurface2: Color(0xFF1A1A1A),
    bgElevated: Color(0xFF1E1E1E),
    textPrimary: Color(0xFFFFFFFF),
    textSecondary: Color(0xFFC9C9C9),
    textMuted: Color(0xFF8C8C8C),
    border: Color(0xFF2A2A2A),
    borderStrong: Color(0xFF3D3D3D),
    danger: Color(0xFFFF6B6B),
    warning: Color(0xFFFFC24D),
    info: Color(0xFF7DB9FF),
    success: Color(0xFF4ADE80),
    purple: Color(0xFFC4A6FF),
    grey: Color(0xFF9A9A9A),
  ),
  LumaPalette(
    id: 'classic',
    label: 'كلاسيكي',
    icon: Icons.menu_book,
    isDark: false,
    brand: Color(0xFFA67C3D),
    brandHover: Color(0xFF8A6531),
    brandLight: Color(0xFFC39A5A),
    onBrand: Color(0xFFFFFFFF),
    bgApp: Color(0xFFEFE8DA),
    bgCanvas: Color(0xFFE8DFCD),
    bgSurface: Color(0xFFFBF7EF),
    bgSurface2: Color(0xFFF5EFE2),
    bgElevated: Color(0xFFFFFCF6),
    textPrimary: Color(0xFF2E2820),
    textSecondary: Color(0xFF574E40),
    textMuted: Color(0xFF8C8172),
    border: Color(0xFFD9CDB4),
    borderStrong: Color(0xFFC3B393),
    danger: Color(0xFFF87171),
    warning: Color(0xFFFBBF24),
    info: Color(0xFF60A5FA),
    success: Color(0xFF34D399),
    purple: Color(0xFFA78BFA),
    grey: Color(0xFF7F8998),
  ),
  LumaPalette(
    id: 'space',
    label: 'فضاء',
    icon: Icons.auto_awesome,
    isDark: true,
    brand: Color(0xFFE8B95C),
    brandHover: Color(0xFFD4A548),
    brandLight: Color(0xFFF0CB7E),
    onBrand: Color(0xFF1A1206),
    bgApp: Color(0xFF020E1A),
    bgCanvas: Color(0xFF061B2D),
    bgSurface: Color(0xFF0A2740),
    bgSurface2: Color(0xFF0D2F4A),
    bgElevated: Color(0xFF10395C),
    textPrimary: Color(0xFFF5F7FA),
    textSecondary: Color(0xFFB7C4D6),
    textMuted: Color(0xFF7892AD),
    border: Color(0xFF1C3A54),
    borderStrong: Color(0x66E8B95C),
    danger: Color(0xFFF87171),
    warning: Color(0xFFFBBF24),
    info: Color(0xFF60A5FA),
    success: Color(0xFF34D399),
    purple: Color(0xFFA78BFA),
    grey: Color(0xFF7F8998),
  ),
  LumaPalette(
    id: 'ship',
    label: 'سفينة',
    icon: Icons.rocket_launch,
    isDark: true,
    brand: Color(0xFF22D3EE),
    brandHover: Color(0xFF0EB8D4),
    brandLight: Color(0xFF67E8F9),
    onBrand: Color(0xFF04222A),
    bgApp: Color(0xFF070D13),
    bgCanvas: Color(0xFF0B141C),
    bgSurface: Color(0xFF101D28),
    bgSurface2: Color(0xFF162734),
    bgElevated: Color(0xFF1A2F3F),
    textPrimary: Color(0xFFE6F6FB),
    textSecondary: Color(0xFFA9C2D1),
    textMuted: Color(0xFF6D8798),
    border: Color(0xFF1F3A4D),
    borderStrong: Color(0x6B22D3EE),
    danger: Color(0xFFF87171),
    warning: Color(0xFFFBBF24),
    info: Color(0xFF60A5FA),
    success: Color(0xFF34D399),
    purple: Color(0xFFA78BFA),
    grey: Color(0xFF7F8998),
  ),
  LumaPalette(
    id: 'forest',
    label: 'غابة',
    icon: Icons.forest,
    isDark: true,
    brand: Color(0xFF3FB98F),
    brandHover: Color(0xFF33A07A),
    brandLight: Color(0xFF62D3AC),
    onBrand: Color(0xFF06241A),
    bgApp: Color(0xFF081310),
    bgCanvas: Color(0xFF0B1B15),
    bgSurface: Color(0xFF142A22),
    bgSurface2: Color(0xFF1B352B),
    bgElevated: Color(0xFF1F3D31),
    textPrimary: Color(0xFFEAF5EF),
    textSecondary: Color(0xFFB3C9BF),
    textMuted: Color(0xFF6F8D81),
    border: Color(0xFF24463A),
    borderStrong: Color(0x663FB98F),
    danger: Color(0xFFF87171),
    warning: Color(0xFFFBBF24),
    info: Color(0xFF60A5FA),
    success: Color(0xFF34D399),
    purple: Color(0xFFA78BFA),
    grey: Color(0xFF7F8998),
  ),
  LumaPalette(
    id: 'mocha',
    label: 'موكا',
    icon: Icons.coffee,
    isDark: true,
    brand: Color(0xFFD9A066),
    brandHover: Color(0xFFC08A50),
    brandLight: Color(0xFFE8BB8A),
    onBrand: Color(0xFF2B1C0C),
    bgApp: Color(0xFF140F0B),
    bgCanvas: Color(0xFF1B140F),
    bgSurface: Color(0xFF2A211A),
    bgSurface2: Color(0xFF352A21),
    bgElevated: Color(0xFF3D3026),
    textPrimary: Color(0xFFF3EBE0),
    textSecondary: Color(0xFFCDBFAE),
    textMuted: Color(0xFF8D7D69),
    border: Color(0xFF473A2E),
    borderStrong: Color(0x66D9A066),
    danger: Color(0xFFF87171),
    warning: Color(0xFFFBBF24),
    info: Color(0xFF60A5FA),
    success: Color(0xFF34D399),
    purple: Color(0xFFA78BFA),
    grey: Color(0xFF7F8998),
  ),
  LumaPalette(
    id: 'dawn',
    label: 'فجر',
    icon: Icons.wb_twilight,
    isDark: false,
    brand: Color(0xFFD24E6B),
    brandHover: Color(0xFFB83E59),
    brandLight: Color(0xFFE87D94),
    onBrand: Color(0xFFFFFFFF),
    bgApp: Color(0xFFFBF2F0),
    bgCanvas: Color(0xFFF7EBE8),
    bgSurface: Color(0xFFFFFFFF),
    bgSurface2: Color(0xFFFDF6F4),
    bgElevated: Color(0xFFFFFFFF),
    textPrimary: Color(0xFF3A222A),
    textSecondary: Color(0xFF6A4C54),
    textMuted: Color(0xFF9A8087),
    border: Color(0xFFEFDCD8),
    borderStrong: Color(0xFFE0C4BF),
    danger: Color(0xFFF87171),
    warning: Color(0xFFFBBF24),
    info: Color(0xFF60A5FA),
    success: Color(0xFF34D399),
    purple: Color(0xFFA78BFA),
    grey: Color(0xFF7F8998),
  ),
  LumaPalette(
    id: 'hacker',
    label: 'هاكر',
    icon: Icons.terminal,
    isDark: true,
    brand: Color(0xFF3DDC71),
    brandHover: Color(0xFF2FB85C),
    brandLight: Color(0xFF6BF29A),
    onBrand: Color(0xFF04170B),
    bgApp: Color(0xFF030704),
    bgCanvas: Color(0xFF050B07),
    bgSurface: Color(0xFF0B1710),
    bgSurface2: Color(0xFF102015),
    bgElevated: Color(0xFF13271A),
    textPrimary: Color(0xFFD6F5E0),
    textSecondary: Color(0xFFA6C9B2),
    textMuted: Color(0xFF6E9179),
    border: Color(0xFF1C3A26),
    borderStrong: Color(0x6B3DDC71),
    danger: Color(0xFFF87171),
    warning: Color(0xFFFBBF24),
    info: Color(0xFF60A5FA),
    success: Color(0xFF34D399),
    purple: Color(0xFFA78BFA),
    grey: Color(0xFF7F8998),
  ),
  LumaPalette(
    id: 'hacker-light',
    label: 'هاكر فاتح',
    icon: Icons.code,
    isDark: false,
    brand: Color(0xFF0F7A42),
    brandHover: Color(0xFF0B6234),
    brandLight: Color(0xFF149853),
    onBrand: Color(0xFFFFFFFF),
    bgApp: Color(0xFFEEF3EE),
    bgCanvas: Color(0xFFF4F8F4),
    bgSurface: Color(0xFFFFFFFF),
    bgSurface2: Color(0xFFF5F9F5),
    bgElevated: Color(0xFFFFFFFF),
    textPrimary: Color(0xFF10231A),
    textSecondary: Color(0xFF3C5546),
    textMuted: Color(0xFF5C7A68),
    border: Color(0xFFDDE7DF),
    borderStrong: Color(0xFFC2D4C7),
    danger: Color(0xFFC62828),
    warning: Color(0xFFA15C00),
    info: Color(0xFF1565C0),
    success: Color(0xFF1B7A43),
    purple: Color(0xFF6A3FB5),
    grey: Color(0xFF5C7A68),
  ),
];

/// WCAG relative luminance, used to pick a legible shade at runtime.
double _luminance(Color c) {
  double channel(double v) =>
      v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

double contrastRatio(Color a, Color b) {
  final la = _luminance(a);
  final lb = _luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

extension PaletteShades on LumaPalette {
  /// The accent shade that can actually be seen on [background].
  ///
  /// The pale `brandLight` is the right choice on the dark themes it was
  /// designed for, and invisible on the light ones — on "classic" it is a
  /// sand colour on cream. Rather than keep a second table of exceptions,
  /// pick whichever of the two shades has more contrast where it lands.
  Color accentOn(Color background) =>
      contrastRatio(brandLight, background) >= contrastRatio(brand, background)
          ? brandLight
          : brand;
}

extension ReadableColour on Color {
  /// The same hue, darkened (or lightened) until it can be read on
  /// [background].
  ///
  /// The site's light themes inherit their status colours from the dark one:
  /// `--warning: #FBBF24` is a yellow mixed for a navy card, and on a white
  /// card it measures 1.67:1 — the word is there and nobody can read it.
  /// Matching the site exactly would mean shipping that, so the hue is kept
  /// and only the lightness moves, and only when it has to. On the dark
  /// themes every status colour already passes, so this changes nothing there.
  Color readableOn(Color background, {double target = 3.5}) {
    if (contrastRatio(this, background) >= target) return this;

    final hsl = HSLColor.fromColor(this);
    final darker = _luminance(background) > 0.5;

    for (var step = 1; step <= 20; step++) {
      final lightness = (darker ? hsl.lightness - step * 0.04 : hsl.lightness + step * 0.04)
          .clamp(0.0, 1.0);
      final candidate = hsl.withLightness(lightness).toColor();
      if (contrastRatio(candidate, background) >= target) return candidate;
      if (lightness == 0.0 || lightness == 1.0) return candidate;
    }
    return this;
  }
}
