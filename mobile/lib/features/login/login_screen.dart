import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/app_theme.dart';
import 'scan_screen.dart';

/// The only way in.
///
/// There is no password field on purpose: nobody types an office password into
/// a phone keyboard, and every password typed on a phone is one more place it
/// can leak. The browser is already signed in, so it vouches for the phone.
class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Expanded(child: _PairingMark()),
              const SizedBox(height: 8),
              Text(
                'لوما',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                      letterSpacing: -.5,
                    ),
              ),
              const SizedBox(height: 12),
              Text(
                'افتح الإعدادات على الموقع، اختر «الهاتف»،\nثم امسح الرمز الظاهر على الشاشة.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: AppColors.textSecondary,
                      height: 1.6,
                    ),
              ),
              const SizedBox(height: 28),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const ScanScreen()),
                ),
                icon: const Icon(Icons.qr_code_scanner_rounded),
                label: const Text('مسح رمز الدخول'),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.brand,
                  foregroundColor: AppColors.onBrand,
                  minimumSize: const Size.fromHeight(58),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppRadius.chip),
                  ),
                  textStyle: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Text(
                'لا تحتاج كلمة مرور — الرمز صالح لدقيقتين فقط.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12.5, color: AppColors.textMuted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Rings pushing outward from a QR glyph — the phone reaching for the screen.
/// Drawn rather than shipped as an image so it stays sharp at any size and
/// costs the bundle nothing.
class _PairingMark extends StatefulWidget {
  const _PairingMark();

  @override
  State<_PairingMark> createState() => _PairingMarkState();
}

class _PairingMarkState extends State<_PairingMark>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 4),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Honour the system setting: a looping animation is exactly the kind of
    // motion people turn off.
    final animate = !MediaQuery.disableAnimationsOf(context);

    return Center(
      child: AspectRatio(
        aspectRatio: 1,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, child) => CustomPaint(
            painter: _PairingPainter(animate ? _controller.value : .35),
            child: child,
          ),
          child: Center(
            child: Icon(Icons.qr_code_2_rounded, size: 88, color: AppColors.onBrand),
          ),
        ),
      ),
    );
  }
}

class _PairingPainter extends CustomPainter {
  const _PairingPainter(this.progress);

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final centre = size.center(Offset.zero);
    final maxRadius = size.shortestSide / 2;

    // A brand-coloured disc behind the glyph, so the mark reads as one object.
    canvas.drawCircle(
      centre,
      maxRadius * .34,
      Paint()..color = AppColors.brandTint,
    );
    canvas.drawCircle(
      centre,
      maxRadius * .26,
      Paint()..color = AppColors.brand,
    );

    // Three rings, evenly spaced through one cycle, fading as they grow.
    for (var i = 0; i < 3; i++) {
      final t = (progress + i / 3) % 1.0;
      final radius = maxRadius * (.3 + t * .7);
      final opacity = (1 - t) * .5;
      if (opacity <= 0.01) continue;

      canvas.drawCircle(
        centre,
        radius,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = AppColors.brandHover.withValues(alpha: opacity),
      );
    }

    // Corner brackets, like a viewfinder around the whole mark.
    final bracket = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..color = AppColors.borderStrong;

    final inset = maxRadius * .12;
    final arm = maxRadius * .22;
    final box = Rect.fromCircle(center: centre, radius: maxRadius - inset);

    for (var i = 0; i < 4; i++) {
      final corner = switch (i) {
        0 => box.topLeft,
        1 => box.topRight,
        2 => box.bottomRight,
        _ => box.bottomLeft,
      };
      final dx = i == 0 || i == 3 ? arm : -arm;
      final dy = i < 2 ? arm : -arm;
      canvas.drawLine(corner, corner.translate(dx, 0), bracket);
      canvas.drawLine(corner, corner.translate(0, dy), bracket);
    }

    // A single sweeping tick, to keep the mark alive without noise.
    final sweep = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..color = AppColors.brandLight;
    canvas.drawArc(
      Rect.fromCircle(center: centre, radius: maxRadius * .46),
      progress * 2 * math.pi,
      .5,
      false,
      sweep,
    );
  }

  @override
  bool shouldRepaint(_PairingPainter old) => old.progress != progress;
}
