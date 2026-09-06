import 'package:flutter/material.dart';

import '../core/app_colors.dart';

/// The Today / Weekly / Monthly / Yearly pill selector.
class PeriodTabBar extends StatelessWidget {
  const PeriodTabBar({
    super.key,
    required this.items,
    required this.selected,
    required this.onChanged,
  });

  final List<String> items;
  final int selected;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        for (var i = 0; i < items.length; i++)
          GestureDetector(
            onTap: () => onChanged(i),
            behavior: HitTestBehavior.opaque,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              curve: Curves.easeOut,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              decoration: BoxDecoration(
                color: i == selected ? AppColors.lime : Colors.white,
                borderRadius: BorderRadius.circular(22),
                boxShadow: i == selected
                    ? null
                    : [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.04),
                          blurRadius: 8,
                          offset: const Offset(0, 3),
                        ),
                      ],
              ),
              child: Text(
                items[i],
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: i == selected ? AppColors.ink : AppColors.textSecondary,
                ),
              ),
            ),
          ),
      ],
    );
  }
}
