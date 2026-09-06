import 'package:flutter/material.dart';

import '../../../core/app_colors.dart';

/// A flat, line-art wallet scene drawn on the canvas — no image assets — with a
/// few outline icons scattered around it, echoing the design's hero art.
class OnboardingIllustration extends StatelessWidget {
  const OnboardingIllustration({super.key});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const Positioned(left: 2, top: 14, child: _Deco(Icons.monetization_on_outlined)),
        const Positioned(right: 6, top: 2, child: _Deco(Icons.qr_code_2_rounded)),
        const Positioned(right: 0, top: 92, child: _Deco(Icons.credit_card)),
        const Positioned(left: 0, bottom: 54, child: _Deco(Icons.receipt_long)),
        const Positioned(right: 20, bottom: 30, child: _Deco(Icons.attach_money_rounded)),
        Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18),
            child: AspectRatio(
              aspectRatio: 1,
              child: CustomPaint(painter: _WalletPainter()),
            ),
          ),
        ),
      ],
    );
  }
}

class _Deco extends StatelessWidget {
  const _Deco(this.icon);

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Icon(icon, size: 26, color: AppColors.ink.withValues(alpha: 0.55));
  }
}

class _WalletPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeJoin = StrokeJoin.round
      ..strokeCap = StrokeCap.round
      ..color = AppColors.ink;
    final cream = Paint()..color = const Color(0xFFF4EEDD);
    final white = Paint()..color = Colors.white;
    final dark = Paint()..color = AppColors.ink;

    // Soft disc behind the wallet.
    canvas.drawCircle(
      Offset(w * 0.5, h * 0.52),
      w * 0.42,
      Paint()..color = AppColors.limeDark,
    );

    // Card peeking out from behind, slightly tilted.
    canvas
      ..save()
      ..translate(w * 0.52, h * 0.33)
      ..rotate(-0.12);
    final cardRect = RRect.fromRectAndRadius(
      Rect.fromCenter(center: Offset.zero, width: w * 0.5, height: h * 0.3),
      const Radius.circular(12),
    );
    canvas
      ..drawRRect(cardRect, white)
      ..drawRRect(cardRect, stroke)
      ..drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(-w * 0.22, -h * 0.02, w * 0.44, h * 0.05),
          const Radius.circular(4),
        ),
        dark,
      )
      ..restore();

    // Wallet body.
    final body = RRect.fromRectAndRadius(
      Rect.fromLTWH(w * 0.16, h * 0.44, w * 0.66, h * 0.4),
      const Radius.circular(22),
    );
    canvas
      ..drawRRect(body, cream)
      ..drawRRect(body, stroke)
      ..drawLine(Offset(w * 0.16, h * 0.56), Offset(w * 0.82, h * 0.56), stroke)
      ..drawCircle(Offset(w * 0.66, h * 0.64), w * 0.035, dark);

    // Contactless waves.
    final waves = Rect.fromCircle(center: Offset(w * 0.30, h * 0.71), radius: w * 0.05);
    for (var i = 0; i < 3; i++) {
      canvas.drawArc(waves.inflate(i * 7.0), -0.9, 1.8, false, stroke);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
