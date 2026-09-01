import 'package:flutter/material.dart';

import '../core/app_colors.dart';
import '../core/app_theme.dart';
import 'luma_image.dart';

/// The standard screen: a large title that scrolls away, then content.
class LumaPage extends StatelessWidget {
  const LumaPage({
    super.key,
    required this.title,
    required this.child,
    this.subtitle,
    this.trailing,
    this.onBack,
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onBack;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final sub = subtitle;

    return Scaffold(
      backgroundColor: AppColors.bgApp,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(onBack != null ? 6 : 20, 12, 20, 14),
              child: Row(
                children: [
                  if (onBack != null)
                    IconButton(
                      onPressed: onBack,
                      icon: const Icon(Icons.arrow_forward_rounded),
                      color: AppColors.textSecondary,
                      tooltip: 'رجوع',
                    ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -.3,
                          ),
                        ),
                        if (sub != null) ...[
                          const SizedBox(height: 2),
                          Text(
                            sub,
                            style: TextStyle(
                              fontSize: 13,
                              color: AppColors.textMuted,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  ?trailing,
                ],
              ),
            ),
            Expanded(child: child),
          ],
        ),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.text,
    this.tone,
  });

  final IconData icon;
  final String title;
  final String? text;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final body = text;

    return Center(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(40, 0, 40, 100),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 74,
              height: 74,
              decoration: BoxDecoration(
                color: (tone ?? AppColors.brand).withValues(alpha: .12),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 32, color: tone ?? AppColors.brandLight),
            ),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
            if (body != null) ...[
              const SizedBox(height: 6),
              Text(
                body,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 13.5,
                  height: 1.6,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Initials, or a photo when there is one.
class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.name, this.url, this.size = 44});

  final String name;
  final String? url;
  final double size;

  @override
  Widget build(BuildContext context) {
    final initial = name.trim().isEmpty
        ? '؟'
        : name.trim().characters.take(1).toString();

    return CircleAvatar(
      radius: size / 2,
      backgroundColor: AppColors.brand.withValues(alpha: .16),
      foregroundImage: imageProviderFor(url),
      // A photo that fails to load leaves the initials showing rather than an
      // error box.
      onForegroundImageError: (_, _) {},
      child: Text(
        initial,
        style: TextStyle(
          color: AppColors.brandLight,
          fontWeight: FontWeight.w800,
          fontSize: size * .4,
        ),
      ),
    );
  }
}

/// A small coloured label — status, type, priority.
class Pill extends StatelessWidget {
  const Pill({
    super.key,
    required this.label,
    required this.color,
    this.icon,
  });

  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final glyph = icon;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .14),
        borderRadius: BorderRadius.circular(AppRadius.chip),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (glyph != null) ...[
            Icon(glyph, size: 14, color: color),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

/// A card that reacts to a tap, with the app's radius already applied.
class TapCard extends StatelessWidget {
  const TapCard({
    super.key,
    required this.child,
    this.onTap,
    this.color,
    this.padding = const EdgeInsets.all(16),
  });

  final Widget child;
  final VoidCallback? onTap;
  final Color? color;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color ?? AppColors.bgSurface,
      borderRadius: BorderRadius.circular(AppRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.tile),
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}

/// A stream that shows a spinner, an honest message on failure, and an empty
/// state — the three things every list on this app needs and none of them
/// worth writing five times.
class StreamList<T> extends StatelessWidget {
  const StreamList({
    super.key,
    required this.stream,
    required this.itemBuilder,
    required this.empty,
    this.padding = const EdgeInsets.fromLTRB(20, 4, 20, 120),
    this.separator = 10,
  });

  final Stream<List<T>> stream;
  final Widget Function(BuildContext, T) itemBuilder;
  final Widget empty;
  final EdgeInsets padding;
  final double separator;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<T>>(
      stream: stream,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return EmptyState(
            icon: Icons.lock_outline_rounded,
            title: 'لا تملك صلاحية عرض هذا القسم',
            text: 'اطلب من مدير النظام تعديل صلاحياتك.',
            tone: AppColors.warning,
          );
        }
        if (!snapshot.hasData) {
          return Center(
            child: CircularProgressIndicator(color: AppColors.brand),
          );
        }

        final items = snapshot.data!;
        if (items.isEmpty) return empty;

        return ListView.separated(
          padding: padding,
          itemCount: items.length,
          separatorBuilder: (_, _) => SizedBox(height: separator),
          itemBuilder: (context, i) => itemBuilder(context, items[i]),
        );
      },
    );
  }
}
