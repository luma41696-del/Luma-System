import 'package:flutter/material.dart';

import '../core/app_colors.dart';

class NavItem {
  const NavItem({required this.icon, required this.label, this.badge = false});

  final IconData icon;
  final String label;
  final bool badge;
}

/// The floating pill from the design, with a raised centre button.
///
/// It goes in a Scaffold's `bottomNavigationBar`, which hands its child loose
/// constraints as tall as the whole screen. A `Center` there does not centre
/// the pill at the bottom — it expands to fill that height and the bar takes
/// over the entire screen, drawing the pill across the middle of the content.
/// `heightFactor: 1` is what makes the bar only as tall as the pill.
class PillNav extends StatelessWidget {
  const PillNav({
    super.key,
    required this.items,
    required this.index,
    required this.onSelect,
    required this.onCentre,
    required this.centreIcon,
    required this.centreLabel,
  });

  final List<NavItem> items;
  final int index;
  final ValueChanged<int> onSelect;
  final VoidCallback onCentre;
  final IconData centreIcon;
  final String centreLabel;

  @override
  Widget build(BuildContext context) {
    final half = items.length ~/ 2;

    return SafeArea(
      minimum: const EdgeInsets.only(bottom: 14),
      child: Align(
        alignment: Alignment.bottomCenter,
        heightFactor: 1,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.bgElevated,
              borderRadius: BorderRadius.circular(40),
              border: Border.all(color: AppColors.border),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: .38),
                  blurRadius: 26,
                  offset: const Offset(0, 12),
                ),
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (var i = 0; i < half; i++) _icon(i),
                _CentreButton(
                  icon: centreIcon,
                  label: centreLabel,
                  onTap: onCentre,
                ),
                for (var i = half; i < items.length; i++) _icon(i),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _icon(int i) => _NavIcon(
        item: items[i],
        active: index == i,
        onTap: () => onSelect(i),
      );
}

class _NavIcon extends StatelessWidget {
  const _NavIcon({
    required this.item,
    required this.active,
    required this.onTap,
  });

  final NavItem item;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: item.label,
      selected: active,
      button: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 240),
          curve: Curves.easeOut,
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 9),
          decoration: BoxDecoration(
            color: active ? AppColors.brand.withValues(alpha: .18) : null,
            borderRadius: BorderRadius.circular(22),
          ),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Icon(
                item.icon,
                size: 23,
                color: active ? AppColors.brandOnElevated : AppColors.textMuted,
              ),
              if (item.badge)
                PositionedDirectional(
                  top: -2,
                  end: -2,
                  child: Container(
                    width: 9,
                    height: 9,
                    decoration: BoxDecoration(
                      color: AppColors.danger,
                      shape: BoxShape.circle,
                      border: Border.all(color: AppColors.bgElevated, width: 1.5),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CentreButton extends StatelessWidget {
  const _CentreButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      button: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: GestureDetector(
          onTap: onTap,
          child: Container(
            width: 50,
            height: 50,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [AppColors.brandLight, AppColors.brand],
              ),
              boxShadow: [
                BoxShadow(
                  color: AppColors.brand.withValues(alpha: .45),
                  blurRadius: 16,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: Icon(icon, color: AppColors.onBrand, size: 24),
          ),
        ),
      ),
    );
  }
}
