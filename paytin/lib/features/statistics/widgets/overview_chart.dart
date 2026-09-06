import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../core/app_colors.dart';
import '../../../core/format.dart';
import '../../../models/month_spending.dart';

/// The segmented bar chart: each month is a stack of small rounded blocks,
/// green for debit-card spend, dark for credit-card spend. The highlighted
/// month gets a value tooltip on a dashed leader line.
class OverviewChart extends StatelessWidget {
  const OverviewChart({
    super.key,
    required this.months,
    required this.highlightIndex,
  });

  final List<MonthSpending> months;
  final int highlightIndex;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 250,
      child: CustomPaint(
        painter: _ChartPainter(months: months, highlight: highlightIndex),
        child: const SizedBox.expand(),
      ),
    );
  }
}

class _ChartPainter extends CustomPainter {
  _ChartPainter({required this.months, required this.highlight});

  final List<MonthSpending> months;
  final int highlight;

  static const double _axisMax = 3500;
  static const List<double> _gridValues = [0, 1000, 2000, 3000, 3500];
  static const double _blockH = 11;
  static const double _blockGap = 5;
  static const double _barW = 26;
  static const double _leftPad = 44;
  static const double _bottomPad = 24;
  static const double _topPad = 36;

  @override
  void paint(Canvas canvas, Size size) {
    final plot = Rect.fromLTRB(
      _leftPad,
      _topPad,
      size.width,
      size.height - _bottomPad,
    );

    double yFor(double value) =>
        plot.bottom - (value / _axisMax).clamp(0.0, 1.0) * plot.height;

    // Grid lines + axis labels.
    final gridPaint = Paint()
      ..color = const Color(0xFFE4E8DA)
      ..strokeWidth = 1;
    for (final value in _gridValues) {
      final y = yFor(value);
      canvas.drawLine(Offset(plot.left, y), Offset(plot.right, y), gridPaint);
      _drawText(
        canvas,
        '\$${value.toInt()}',
        Offset(0, y - 6),
        const TextStyle(color: AppColors.textMuted, fontSize: 10),
        width: _leftPad - 10,
        align: TextAlign.right,
      );
    }

    final columnW = plot.width / months.length;

    for (var i = 0; i < months.length; i++) {
      final month = months[i];
      final total = month.total.clamp(0.0, _axisMax);
      final centerX = plot.left + columnW * i + columnW / 2;

      final barPixels = plot.bottom - yFor(total);
      final blocks =
          (barPixels / (_blockH + _blockGap)).floor().clamp(1, 40);
      final greenBlocks =
          (blocks * (month.debit / month.total)).round().clamp(0, blocks);

      for (var b = 0; b < blocks; b++) {
        final top = plot.bottom - (b + 1) * _blockH - b * _blockGap;
        final rect = RRect.fromRectAndRadius(
          Rect.fromLTWH(centerX - _barW / 2, top, _barW, _blockH),
          const Radius.circular(3),
        );
        canvas.drawRRect(
          rect,
          Paint()..color = b < greenBlocks ? AppColors.lime : AppColors.ink,
        );
      }

      _drawText(
        canvas,
        month.label,
        Offset(centerX - columnW / 2, plot.bottom + 8),
        TextStyle(
          color: i == highlight ? AppColors.ink : AppColors.textMuted,
          fontSize: 10,
          fontWeight: i == highlight ? FontWeight.w700 : FontWeight.w500,
        ),
        width: columnW,
        align: TextAlign.center,
      );

      if (i == highlight) {
        final barTop =
            plot.bottom - blocks * _blockH - (blocks - 1) * _blockGap;
        _drawDashedVertical(canvas, centerX, _topPad + 22, barTop - 5);
        _drawTooltip(canvas, centerX, _topPad + 2, money(month.total));
      }
    }
  }

  void _drawTooltip(Canvas canvas, double centerX, double top, String label) {
    final painter = TextPainter(
      text: TextSpan(
        text: label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();

    final w = painter.width + 20;
    final h = painter.height + 12;
    final rect = RRect.fromRectAndRadius(
      Rect.fromLTWH(centerX - w / 2, top, w, h),
      const Radius.circular(8),
    );
    canvas.drawRRect(rect, Paint()..color = AppColors.ink);
    painter.paint(canvas, Offset(centerX - painter.width / 2, top + 6));

    final tail = Path()
      ..moveTo(centerX - 5, top + h)
      ..lineTo(centerX + 5, top + h)
      ..lineTo(centerX, top + h + 6)
      ..close();
    canvas.drawPath(tail, Paint()..color = AppColors.ink);
  }

  void _drawDashedVertical(Canvas canvas, double x, double y1, double y2) {
    const dash = 4.0;
    const gap = 4.0;
    final paint = Paint()
      ..color = const Color(0xFFB9C0AC)
      ..strokeWidth = 1.2;
    var y = y1;
    while (y < y2) {
      canvas.drawLine(Offset(x, y), Offset(x, math.min(y + dash, y2)), paint);
      y += dash + gap;
    }
  }

  void _drawText(
    Canvas canvas,
    String text,
    Offset at,
    TextStyle style, {
    double? width,
    TextAlign align = TextAlign.left,
  }) {
    final painter = TextPainter(
      text: TextSpan(text: text, style: style),
      textDirection: TextDirection.ltr,
      textAlign: align,
    )..layout(minWidth: width ?? 0, maxWidth: width ?? double.infinity);
    painter.paint(canvas, at);
  }

  @override
  bool shouldRepaint(covariant _ChartPainter oldDelegate) =>
      oldDelegate.highlight != highlight || oldDelegate.months != months;
}
