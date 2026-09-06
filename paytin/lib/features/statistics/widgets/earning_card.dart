import 'package:flutter/material.dart';

import '../../../core/app_colors.dart';
import '../../../core/format.dart';
import '../../../data/demo_data.dart';

class EarningCard extends StatelessWidget {
  const EarningCard({super.key});

  @override
  Widget build(BuildContext context) {
    final progress = (DemoData.goalCurrent / DemoData.goalTarget).clamp(0.0, 1.0);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.lime,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.trending_up_rounded, size: 16, color: AppColors.ink),
              SizedBox(width: 6),
              Text(
                'Earning',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
              ),
              Spacer(),
              Icon(Icons.more_horiz, size: 16, color: AppColors.ink),
            ],
          ),
          const SizedBox(height: 14),
          const Text(
            '${DemoData.monthlyEarningPct}%',
            style: TextStyle(
              fontSize: 30,
              fontWeight: FontWeight.w800,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Your current month earning is increased by 24% compared to last month.',
            style: TextStyle(fontSize: 10.5, height: 1.35, color: Color(0xFF44521F)),
          ),
          const SizedBox(height: 14),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              const Text(
                'Goal',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '${money(DemoData.goalCurrent)}/${money(DemoData.goalTarget)}',
                  style: const TextStyle(
                    fontSize: 10,
                    color: Color(0xFF44521F),
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          _GoalMeter(progress: progress),
        ],
      ),
    );
  }
}

class _GoalMeter extends StatelessWidget {
  const _GoalMeter({required this.progress});

  final double progress;

  @override
  Widget build(BuildContext context) {
    const segments = 13;
    final filled = (progress * segments).round();

    return Row(
      children: [
        for (var i = 0; i < segments; i++)
          Expanded(
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 1.5),
              height: 8,
              decoration: BoxDecoration(
                color: i < filled ? AppColors.ink : Colors.white.withValues(alpha: 0.55),
                borderRadius: BorderRadius.circular(4),
              ),
            ),
          ),
      ],
    );
  }
}
