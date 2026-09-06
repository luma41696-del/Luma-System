import 'package:flutter/material.dart';

import '../../../core/app_colors.dart';
import '../../../core/format.dart';
import '../../../data/demo_data.dart';

class BalanceCard extends StatelessWidget {
  const BalanceCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Container(
          margin: const EdgeInsets.only(top: 14),
          padding: const EdgeInsets.fromLTRB(22, 24, 12, 20),
          decoration: BoxDecoration(
            color: AppColors.ink,
            borderRadius: BorderRadius.circular(26),
            boxShadow: [
              BoxShadow(
                color: AppColors.ink.withValues(alpha: 0.28),
                blurRadius: 24,
                offset: const Offset(0, 14),
              ),
            ],
          ),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(
                        children: [
                          Text(
                            'VISA',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w800,
                              fontStyle: FontStyle.italic,
                              fontSize: 18,
                              letterSpacing: 1,
                            ),
                          ),
                          SizedBox(width: 8),
                          Icon(Icons.auto_awesome, color: AppColors.lime, size: 18),
                        ],
                      ),
                      const SizedBox(height: 22),
                      const Text(
                        'Balance',
                        style: TextStyle(color: Colors.white54, fontSize: 12),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '\$ ${money(DemoData.balance).substring(1)}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 24,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Row(
                        children: [
                          _MaskGroup(),
                          SizedBox(width: 10),
                          _MaskGroup(),
                          SizedBox(width: 10),
                          _MaskGroup(),
                          SizedBox(width: 10),
                          Text(
                            DemoData.cardNumberTail,
                            style: TextStyle(
                              color: Colors.white70,
                              fontSize: 13,
                              letterSpacing: 2,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      const Row(
                        children: [
                          Text(
                            DemoData.userName,
                            style: TextStyle(color: Colors.white70, fontSize: 12),
                          ),
                          Spacer(),
                          Text(
                            'Exp ${DemoData.cardExp}',
                            style: TextStyle(
                              color: Colors.white70,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Column(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Container(
                      width: 30,
                      height: 92,
                      decoration: BoxDecoration(
                        color: AppColors.lime,
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                    const Icon(Icons.contactless, color: Colors.white54, size: 22),
                  ],
                ),
              ],
            ),
          ),
        ),
        Positioned(
          right: 18,
          top: 0,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.inkSoft,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Colors.white12),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.add, color: AppColors.lime, size: 16),
                SizedBox(width: 6),
                Text(
                  'Set Budget',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _MaskGroup extends StatelessWidget {
  const _MaskGroup();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(
        4,
        (_) => Container(
          margin: const EdgeInsets.symmetric(horizontal: 1.5),
          width: 5,
          height: 5,
          decoration: const BoxDecoration(
            color: Colors.white54,
            shape: BoxShape.circle,
          ),
        ),
      ),
    );
  }
}
