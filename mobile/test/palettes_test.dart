import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:luma/core/palettes.dart';
import 'package:luma/core/theme_controller.dart';

/// WCAG relative luminance.
double _luminance(Color c) {
  double channel(double v) =>
      v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

double contrast(Color a, Color b) {
  final la = _luminance(a);
  final lb = _luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

void main() {
  test('every site theme is present and distinct', () {
    expect(lumaPalettes.length, 12);
    expect(lumaPalettes.map((p) => p.id).toSet().length, 12);
    expect(
      lumaPalettes.map((p) => p.id),
      containsAll(['dark', 'light', 'mono', 'mono-dark', 'forest', 'mocha',
                   'dawn', 'hacker', 'hacker-light']),
    );
  });

  test('the monochrome pair is one the exact reverse of the other', () {
    final light = ThemeController.byId('mono');
    final dark = ThemeController.byId('mono-dark');

    expect(light.isDark, isFalse);
    expect(dark.isDark, isTrue);
    // Black on white, white on black: each one's accent is the other's ground.
    expect(_luminance(light.brand), lessThan(0.1));
    expect(_luminance(dark.brand), greaterThan(0.9));
    expect(_luminance(light.bgApp), greaterThan(0.8));
    expect(_luminance(dark.bgApp), lessThan(0.05));
  });

  test('the hacker pair really is one dark and one light', () {
    final dark = ThemeController.byId('hacker');
    final light = ThemeController.byId('hacker-light');

    expect(dark.isDark, isTrue);
    expect(light.isDark, isFalse);
    // Same idea, opposite grounds — and both green.
    expect(_luminance(dark.bgApp), lessThan(_luminance(light.bgApp)));
    expect(dark.brand.g, greaterThan(dark.brand.r));
    expect(light.brand.g, greaterThan(light.brand.r));
  });

  test('a theme id that no longer exists falls back instead of throwing', () {
    expect(ThemeController.byId('does-not-exist').id, lumaPalettes.first.id);
    expect(ThemeController.byId('forest').id, 'forest');
  });

  test('isDark matches how light the background actually is', () {
    for (final p in lumaPalettes) {
      final light = _luminance(p.bgApp) > 0.5;
      expect(p.isDark, isNot(light), reason: '${p.id} background vs isDark');
    }
  });

  group('every theme stays readable', () {
    // These were extracted from the stylesheet in bulk; nobody eyeballed ten
    // palettes, so the numbers have to.
    for (final p in lumaPalettes) {
      test(p.id, () {
        expect(contrast(p.textPrimary, p.bgApp), greaterThanOrEqualTo(4.5),
            reason: 'body text on the app background');
        expect(contrast(p.textPrimary, p.bgSurface), greaterThanOrEqualTo(4.5),
            reason: 'body text on a card');
        expect(contrast(p.textSecondary, p.bgSurface), greaterThanOrEqualTo(4.5),
            reason: 'secondary text on a card');
        expect(contrast(p.textMuted, p.bgSurface), greaterThanOrEqualTo(3.0),
            reason: 'muted text on a card');
        expect(contrast(p.onBrand, p.brand), greaterThanOrEqualTo(3.0),
            reason: 'text on the accent');
        // The pale brandLight is invisible on a near-white pill, so the app
        // picks the shade that fits the ground it lands on.
        expect(contrast(p.accentOn(p.bgElevated), p.bgElevated),
            greaterThanOrEqualTo(3.0),
            reason: 'active nav icon on the pill');
        expect(contrast(p.accentOn(p.bgSurface), p.bgSurface),
            greaterThanOrEqualTo(3.0),
            reason: 'accent on a card');
        // The site's light themes inherit their status colours from the dark
        // one, where a pale red and a bright yellow belong; on a white card
        // they measure 2.77 and 1.67. The app keeps the hue and moves the
        // lightness until the word can be read, and this checks the colour
        // that actually gets painted.
        for (final (name, colour) in [
          ('danger', p.danger),
          ('warning', p.warning),
          ('success', p.success),
          ('info', p.info),
        ]) {
          expect(contrast(colour.readableOn(p.bgSurface), p.bgSurface),
              greaterThanOrEqualTo(3.0),
              reason: '$name on a card');
        }
      });
    }
  });
}
