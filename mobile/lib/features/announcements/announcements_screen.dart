import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/format.dart';
import '../../data/models/records.dart';
import '../../data/repos.dart';
import '../../widgets/common.dart';

class AnnouncementsScreen extends StatelessWidget {
  const AnnouncementsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return LumaPage(
      title: 'الإعلانات',
      onBack: () => Navigator.of(context).pop(),
      child: StreamList<Announcement>(
        stream: Repos.instance.announcements(),
        empty: const EmptyState(
          icon: Icons.campaign_rounded,
          title: 'لا توجد إعلانات',
          text: 'كل إعلان جديد من الإدارة يظهر هنا.',
        ),
        itemBuilder: (context, item) => _Card(item: item),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.item});

  final Announcement item;

  @override
  Widget build(BuildContext context) {
    final at = item.createdAt;

    return TapCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: item.kindColor.withValues(alpha: .14),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(item.kindIcon, size: 19, color: item.kindColor),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  item.title.isEmpty ? item.kindLabel : item.title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    height: 1.4,
                  ),
                ),
              ),
            ],
          ),
          if (item.body.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              item.body,
              style: TextStyle(
                fontSize: 14,
                height: 1.75,
                color: AppColors.textSecondary,
              ),
            ),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              Pill(label: item.kindLabel, color: item.kindColor),
              const Spacer(),
              if (item.createdByName.isNotEmpty)
                Text(
                  item.createdByName,
                  style: TextStyle(
                    fontSize: 11.5,
                    color: AppColors.textMuted,
                  ),
                ),
              if (at != null) ...[
                Text(
                  '  ·  ',
                  style: TextStyle(fontSize: 11.5, color: AppColors.textMuted),
                ),
                Text(
                  Fmt.ago(at),
                  style: TextStyle(
                    fontSize: 11.5,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
