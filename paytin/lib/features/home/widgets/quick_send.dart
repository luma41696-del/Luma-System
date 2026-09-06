import 'package:flutter/material.dart';

import '../../../core/app_colors.dart';
import '../../../data/demo_data.dart';
import '../../../widgets/dashed_line.dart';
import '../../../widgets/section_header.dart';

class QuickSend extends StatelessWidget {
  const QuickSend({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Quick Send', actionLabel: 'See all'),
        const SizedBox(height: 16),
        SizedBox(
          height: 66,
          child: Stack(
            children: [
              const Positioned(
                left: 26,
                right: 26,
                top: 21,
                child: DashedLine(),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final contact in DemoData.contacts)
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: contact.color,
                            shape: BoxShape.circle,
                            border: Border.all(color: AppColors.scaffold, width: 3),
                          ),
                          child: Text(
                            contact.initials,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 13,
                              color: AppColors.ink,
                            ),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          contact.name,
                          style: const TextStyle(
                            fontSize: 11,
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
