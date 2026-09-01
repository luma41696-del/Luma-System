import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/app_theme.dart';
import '../../data/session.dart';
import '../announcements/announcements_screen.dart';
import '../appearance/appearance_screen.dart';
import '../calendar/calendar_screen.dart';
import '../chat/chats_screen.dart';
import '../clients/clients_screen.dart';
import '../profile/profile_screen.dart';
import '../requests/requests_screen.dart';
import '../team/team_screen.dart';

/// Everything that does not earn a place in the nav bar.
///
/// Sections are hidden when the viewer's claims say they cannot see them —
/// a screen that opens only to say "denied" is worse than one that is not
/// offered. The rules still decide; this only keeps the grid honest.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = Session.instance;

    final entries = <_Entry>[
      _Entry(
        icon: Icons.forum_rounded,
        label: 'المحادثات',
        colour: AppColors.brandLight,
        build: ChatsScreen.new,
      ),
      if (session.can('clients.view'))
        _Entry(
          icon: Icons.apartment_rounded,
          label: 'العملاء',
          colour: AppColors.info,
          build: ClientsScreen.new,
        ),
      _Entry(
        icon: Icons.assignment_turned_in_rounded,
        label: 'الطلبات',
        colour: AppColors.warning,
        build: RequestsScreen.new,
      ),
      _Entry(
        icon: Icons.campaign_rounded,
        label: 'الإعلانات',
        colour: AppColors.purple,
        build: AnnouncementsScreen.new,
      ),
      _Entry(
        icon: Icons.calendar_month_rounded,
        label: 'التقويم',
        colour: AppColors.brand,
        build: CalendarScreen.new,
      ),
      if (session.can('employees.view'))
        _Entry(
          icon: Icons.groups_rounded,
          label: 'الفريق',
          colour: AppColors.success,
          build: TeamScreen.new,
        ),
      _Entry(
        icon: Icons.palette_rounded,
        label: 'المظهر',
        colour: AppColors.danger,
        build: AppearanceScreen.new,
      ),
      _Entry(
        icon: Icons.person_rounded,
        label: 'حسابي',
        colour: AppColors.textSecondary,
        build: ProfileScreen.new,
      ),
    ];

    return Scaffold(
      backgroundColor: AppColors.bgApp,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 130),
          children: [
            const Text(
              'المزيد',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w800,
                letterSpacing: -.3,
              ),
            ),
            const SizedBox(height: 18),
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 1.22,
              children: [
                for (final entry in entries) _Tile(entry: entry),
              ],
            ),
            const SizedBox(height: 26),
            const _NotOnPhone(),
          ],
        ),
      ),
    );
  }
}

class _Entry {
  const _Entry({
    required this.icon,
    required this.label,
    required this.colour,
    required this.build,
  });

  final IconData icon;
  final String label;
  final Color colour;
  final Widget Function() build;
}

class _Tile extends StatelessWidget {
  const _Tile({required this.entry});

  final _Entry entry;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.bgSurface,
      borderRadius: BorderRadius.circular(AppRadius.card),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.card),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => entry.build()),
        ),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: entry.colour.withValues(alpha: .14),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(entry.icon, color: entry.colour, size: 22),
              ),
              Text(
                entry.label,
                style: const TextStyle(
                  fontSize: 15.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Said plainly rather than left as a mystery: some of the website is not here
/// yet, and pretending otherwise wastes someone's time hunting for it.
class _NotOnPhone extends StatelessWidget {
  const _NotOnPhone();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.bgSurface.withValues(alpha: .5),
        borderRadius: BorderRadius.circular(AppRadius.tile),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.desktop_windows_rounded,
                  size: 18, color: AppColors.textMuted),
              SizedBox(width: 8),
              Text(
                'على الموقع فقط',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
              ),
            ],
          ),
          SizedBox(height: 8),
          Text(
            'القسم المالي، التقارير، الملفات، قاعدة المعرفة والمساعد الذكي — '
            'ما زالت على الموقع.',
            style: TextStyle(
              fontSize: 13,
              color: AppColors.textMuted,
              height: 1.7,
            ),
          ),
        ],
      ),
    );
  }
}
