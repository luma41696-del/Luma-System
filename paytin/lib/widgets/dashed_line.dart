import 'package:flutter/material.dart';

/// A thin horizontal dashed rule, used to connect the Quick Send avatars.
class DashedLine extends StatelessWidget {
  const DashedLine({
    super.key,
    this.color = const Color(0xFFCBD3BE),
    this.dashWidth = 4,
    this.dashGap = 4,
    this.thickness = 1.4,
  });

  final Color color;
  final double dashWidth;
  final double dashGap;
  final double thickness;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: const Size(double.infinity, 2),
      painter: _DashedPainter(color, dashWidth, dashGap, thickness),
    );
  }
}

class _DashedPainter extends CustomPainter {
  _DashedPainter(this.color, this.dashWidth, this.dashGap, this.thickness);

  final Color color;
  final double dashWidth;
  final double dashGap;
  final double thickness;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = thickness
      ..strokeCap = StrokeCap.round;
    final y = size.height / 2;
    var x = 0.0;
    while (x < size.width) {
      canvas.drawLine(Offset(x, y), Offset(x + dashWidth, y), paint);
      x += dashWidth + dashGap;
    }
  }

  @override
  bool shouldRepaint(covariant _DashedPainter oldDelegate) => false;
}
