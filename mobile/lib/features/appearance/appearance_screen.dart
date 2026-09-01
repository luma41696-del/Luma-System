import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/app_theme.dart';
import '../../core/palettes.dart';
import '../../core/theme_controller.dart';
import '../../widgets/common.dart';

/// The website's ten themes, pickable on the phone.
///
/// Each tile paints itself in the theme it offers rather than in the one
/// currently on, so the choice is made by looking rather than by guessing at
/// a name.
class AppearanceScreen extends StatelessWidget {
  const AppearanceScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: ThemeController.instance,
      builder: (context, _) {
        final current = ThemeController.instance.palette.id;

        return LumaPage(
          title: 'المظهر',
          subtitle: 'نفس ثيمات الموقع',
          onBack: () => Navigator.of(context).pop(),
          child: GridView.count(
            crossAxisCount: 2,
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 40),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: .95,
            children: [
              for (final palette in lumaPalettes)
                _Swatch(
                  palette: palette,
                  selected: palette.id == current,
                  onTap: () => ThemeController.instance.select(palette.id),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _Swatch extends StatelessWidget {
  const _Swatch({
    required this.palette,
    required this.selected,
    required this.onTap,
  });

  final LumaPalette palette;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 240),
        curve: Curves.easeOut,
        decoration: BoxDecoration(
          color: palette.bgApp,
          borderRadius: BorderRadius.circular(AppRadius.card),
          border: Border.all(
            color: selected ? AppColors.brand : AppColors.border,
            width: selected ? 2.5 : 1,
          ),
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(palette.icon, size: 18, color: palette.brand),
                const SizedBox(width: 7),
                Expanded(
                  child: Text(
                    palette.label,
                    style: TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w800,
                      color: palette.textPrimary,
                    ),
                  ),
                ),
                if (selected)
                  Icon(Icons.check_circle_rounded,
                      size: 18, color: palette.brand),
              ],
            ),
            const SizedBox(height: 12),
            // A miniature of the app: a card, a line of text, and the accent.
            Expanded(
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: palette.bgSurface,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      height: 8,
                      width: 54,
                      decoration: BoxDecoration(
                        color: palette.textSecondary,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Container(
                      height: 8,
                      width: 34,
                      decoration: BoxDecoration(
                        color: palette.textMuted,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const Spacer(),
                    Row(
                      children: [
                        Container(
                          height: 22,
                          width: 46,
                          decoration: BoxDecoration(
                            color: palette.brand,
                            borderRadius: BorderRadius.circular(999),
                          ),
                        ),
                        const SizedBox(width: 6),
                        for (final dot in [
                          palette.success,
                          palette.warning,
                          palette.danger,
                        ]) ...[
                          Container(
                            width: 9,
                            height: 9,
                            margin: const EdgeInsets.only(left: 4),
                            decoration: BoxDecoration(
                              color: dot,
                              shape: BoxShape.circle,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
