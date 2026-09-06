import 'package:flutter/material.dart';

import '../../../core/app_colors.dart';

class QuickActions extends StatelessWidget {
  const QuickActions({super.key});

  static const _items = <({IconData icon, String label})>[
    (icon: Icons.north_east_rounded, label: 'Send'),
    (icon: Icons.receipt_long_outlined, label: 'Bill'),
    (icon: Icons.smartphone_outlined, label: 'Mobile'),
    (icon: Icons.grid_view_rounded, label: 'More'),
  ];

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        for (final item in _items)
          Column(
            children: [
              Container(
                width: 62,
                height: 62,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.04),
                      blurRadius: 10,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: Icon(item.icon, color: AppColors.ink, size: 24),
              ),
              const SizedBox(height: 8),
              Text(
                item.label,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
      ],
    );
  }
}
