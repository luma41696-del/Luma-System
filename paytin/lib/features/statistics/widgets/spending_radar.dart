import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../core/app_colors.dart';

/// The small geometric "radar" mark on the dark Spending card.
class SpendingRadar extends StatelessWidget {
  const SpendingRadar({super.key});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(painter: _RadarPainter());
  }
}

class _RadarPainter extends CustomPainter {
  static const _values = <double>[0.95, 0.55, 0.78, 0.42];

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final maxR = size.shortestSide / 2;

    final grid = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = Colors.white.withValues(alpha: 0.14);

    Offset point(double radius, int corner) {
      final angle = -math.pi / 2 + corner * math.pi / 2 + math.pi / 4;
      return center + Offset(radius * math.cos(angle), radius * math.sin(angle));
    }

    // Concentric rotated squares + spokes.
    for (var ring = 4; ring >= 1; ring--) {
      final r = maxR * ring / 4;
      final path = Path();
      for (var c = 0; c < 4; c++) {
        final p = point(r, c);
        c == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
      }
      canvas.drawPath(path..close(), grid);
    }
    for (var c = 0; c < 4; c++) {
      canvas.drawLine(center, point(maxR, c), grid);
    }

    // Data polygon.
    final dataPath = Path();
    for (var c = 0; c < 4; c++) {
      final p = point(maxR * _values[c], c);
      c == 0 ? dataPath.moveTo(p.dx, p.dy) : dataPath.lineTo(p.dx, p.dy);
    }
    dataPath.close();

    canvas
      ..drawPath(
        dataPath,
        Paint()
          ..style = PaintingStyle.fill
          ..color = AppColors.lime.withValues(alpha: 0.22),
      )
      ..drawPath(
        dataPath,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..strokeJoin = StrokeJoin.round
          ..color = AppColors.lime,
      );

    // Inner accent square.
    final innerPath = Path();
    for (var c = 0; c < 4; c++) {
      final p = point(maxR * 0.4, c);
      c == 0 ? innerPath.moveTo(p.dx, p.dy) : innerPath.lineTo(p.dx, p.dy);
    }
    canvas.drawPath(
      innerPath..close(),
      Paint()..color = AppColors.teal.withValues(alpha: 0.85),
    );
  }

  @override
  bool shouldRepaint(covariant _RadarPainter oldDelegate) => false;
}
