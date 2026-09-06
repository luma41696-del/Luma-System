import 'package:flutter/material.dart';

import '../../../core/app_colors.dart';
import '../../../core/format.dart';
import '../../../data/demo_data.dart';
import 'spending_radar.dart';

class SpendingCard extends StatelessWidget {
  const SpendingCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.ink,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.trending_down_rounded, size: 16, color: AppColors.lime),
              SizedBox(width: 6),
              Text(
                'Spending',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                  color: Colors.white,
                ),
              ),
              Spacer(),
              Icon(Icons.more_horiz, size: 16, color: Colors.white54),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            money(DemoData.monthlySpending),
            style: const TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.w800,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 12),
          const Center(
            child: SizedBox(width: 118, height: 96, child: SpendingRadar()),
          ),
          const SizedBox(height: 14),
          const Row(
            children: [
              _Dot(color: AppColors.lime, label: 'Debit Card'),
              SizedBox(width: 12),
              _Dot(color: AppColors.teal, label: 'Credit Card'),
            ],
          ),
        ],
      ),
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.circle, size: 7, color: color),
        const SizedBox(width: 5),
        Text(
          label,
          style: const TextStyle(fontSize: 9.5, color: Colors.white70),
        ),
      ],
    );
  }
}
