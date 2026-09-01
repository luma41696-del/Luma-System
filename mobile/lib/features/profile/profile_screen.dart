import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/app_theme.dart';
import '../../core/theme_controller.dart';
import '../../data/api.dart';
import '../../data/models/task.dart';
import '../../data/presence.dart';
import '../../data/session.dart';
import '../../data/tasks_repo.dart';
import '../../widgets/common.dart';
import '../appearance/appearance_screen.dart';
import 'edit_profile_screen.dart';

/// The same profile the website shows, statistics included — completed,
/// remaining, overdue, completion rate, and what has been finished today,
/// this week, this month and this year.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  Future<void> _signOut(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('تسجيل الخروج'),
        content: const Text(
          'سيلزمك مسح رمز جديد من الموقع لتسجيل الدخول مرة أخرى.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('إلغاء'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text('خروج', style: TextStyle(color: AppColors.danger)),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    // Say goodbye before the socket closes, or this device lingers as online.
    await Presence.instance.stop();
    // The server address goes with the session: the next pairing decides it
    // again, so a phone handed to someone else keeps nothing.
    await LumaApi.instance.forget();
    await Session.instance.signOut();
  }

  @override
  Widget build(BuildContext context) {
    return LumaPage(
      title: 'حسابي',
      onBack: Navigator.of(context).canPop()
          ? () => Navigator.of(context).pop()
          : null,
      child: ListenableBuilder(
        listenable: Session.instance,
        builder: (context, _) {
          final session = Session.instance;

          return StreamBuilder<List<Task>>(
            stream: TasksRepo.instance.myTasks(),
            builder: (context, snapshot) {
              final summary = TaskSummary.of(snapshot.data ?? const <Task>[]);

              return ListView(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 130),
                children: [
                  _Header(session: session),
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const EditProfileScreen(),
                      ),
                    ),
                    icon: const Icon(Icons.edit_outlined, size: 18),
                    label: const Text('تعديل المعلومات'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.brandLight,
                      minimumSize: const Size.fromHeight(46),
                      side: BorderSide(color: AppColors.border),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppRadius.chip),
                      ),
                      textStyle: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  _SectionTitle(
                    icon: Icons.bar_chart_rounded,
                    text: 'الإحصائيات',
                  ),
                  const SizedBox(height: 12),
                  _RateCard(summary: summary, loaded: snapshot.hasData),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: _StatTile(
                          icon: Icons.check_circle_outline_rounded,
                          value: summary.completed,
                          label: 'مهام مكتملة',
                          tone: AppColors.success,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _StatTile(
                          icon: Icons.list_alt_rounded,
                          value: summary.open,
                          label: 'مهام متبقية',
                          tone: AppColors.info,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _StatTile(
                          icon: Icons.warning_amber_rounded,
                          value: summary.overdue,
                          label: 'متأخرة',
                          tone: AppColors.danger,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 22),
                  _SectionTitle(icon: Icons.trending_up_rounded, text: 'الإنجاز'),
                  const SizedBox(height: 12),
                  _Completed(summary: summary),
                  const SizedBox(height: 22),
                  _SectionTitle(icon: Icons.tune_rounded, text: 'الحساب'),
                  const SizedBox(height: 12),
                  TapCard(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      children: [
                        _Row(
                          icon: Icons.badge_outlined,
                          label: 'الدور',
                          value: session.isAdmin ? 'مدير النظام' : 'موظف',
                        ),
                        const Divider(height: 22),
                        _Row(
                          icon: Icons.key_outlined,
                          label: 'الصلاحيات',
                          value: session.isAdmin
                              ? 'كاملة'
                              : '${session.permissions.length}',
                        ),
                        const Divider(height: 22),
                        _Row(
                          icon: Icons.dns_outlined,
                          label: 'الخادم',
                          value: _host(LumaApi.instance.base),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  ListenableBuilder(
                    listenable: ThemeController.instance,
                    builder: (context, _) => TapCard(
                      padding: const EdgeInsets.all(18),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => const AppearanceScreen(),
                        ),
                      ),
                      child: _Row(
                        icon: Icons.palette_outlined,
                        label: 'المظهر',
                        value: ThemeController.instance.palette.label,
                        chevron: true,
                      ),
                    ),
                  ),
                  const SizedBox(height: 22),
                  OutlinedButton.icon(
                    onPressed: () => _signOut(context),
                    icon: const Icon(Icons.logout_rounded),
                    label: const Text('تسجيل الخروج'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.danger,
                      minimumSize: const Size.fromHeight(52),
                      side: BorderSide(color: AppColors.border),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppRadius.chip),
                      ),
                      textStyle: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }

  static String _host(String? base) {
    if (base == null || base.isEmpty) return 'غير مرتبط';
    final host = Uri.tryParse(base)?.host;
    return host == null || host.isEmpty ? base : host;
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.session});

  final Session session;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        PresenceAvatar(
          uid: session.uid,
          name: session.displayName,
          url: session.photoUrl,
          size: 92,
          ringColor: AppColors.bgApp,
        ),
        const SizedBox(height: 14),
        StreamBuilder<WorkState>(
          stream: Presence.instance.of(session.uid),
          initialData: WorkState.offline,
          builder: (context, snapshot) {
            final state = snapshot.data ?? WorkState.offline;
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Pill(label: state.label, color: state.color),
            );
          },
        ),
        Text(
          session.displayName,
          style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w800),
        ),
        if (session.jobTitle.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(
            session.jobTitle,
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5),
          ),
        ],
      ],
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: AppColors.textMuted),
        const SizedBox(width: 8),
        Text(
          text,
          style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w800),
        ),
      ],
    );
  }
}

/// The completion rate, drawn as a ring that fills as the number arrives.
class _RateCard extends StatelessWidget {
  const _RateCard({required this.summary, required this.loaded});

  final TaskSummary summary;
  final bool loaded;

  @override
  Widget build(BuildContext context) {
    return TapCard(
      padding: const EdgeInsets.all(20),
      child: Row(
        children: [
          TweenAnimationBuilder<double>(
            tween:
                Tween(begin: 0, end: loaded ? summary.completionRate / 100 : 0),
            duration: const Duration(milliseconds: 900),
            curve: Curves.easeOutCubic,
            builder: (context, value, _) => SizedBox(
              width: 84,
              height: 84,
              child: CustomPaint(
                painter: _RingPainter(
                  value: value,
                  track: AppColors.bgSurface2,
                  fill: AppColors.brand,
                ),
                child: Center(
                  child: Text(
                    '${(value * 100).round()}%',
                    style: const TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 20),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'نسبة الإنجاز',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 6),
                Text(
                  'أنجزتَ ${summary.completed} من أصل ${summary.total} مهمة '
                  'مسندة إليك.',
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.65,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  const _RingPainter({
    required this.value,
    required this.track,
    required this.fill,
  });

  final double value;
  final Color track;
  final Color fill;

  @override
  void paint(Canvas canvas, Size size) {
    final centre = size.center(Offset.zero);
    final radius = size.shortestSide / 2 - 5;

    canvas.drawCircle(
      centre,
      radius,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 9
        ..color = track,
    );

    if (value <= 0) return;
    canvas.drawArc(
      Rect.fromCircle(center: centre, radius: radius),
      -math.pi / 2,
      value.clamp(0, 1) * 2 * math.pi,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 9
        ..strokeCap = StrokeCap.round
        ..color = fill,
    );
  }

  @override
  bool shouldRepaint(_RingPainter old) =>
      old.value != value || old.fill != fill || old.track != track;
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.icon,
    required this.value,
    required this.label,
    required this.tone,
  });

  final IconData icon;
  final int value;
  final String label;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return TapCard(
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 10),
      child: Column(
        children: [
          Icon(icon, color: tone, size: 21),
          const SizedBox(height: 8),
          Text(
            '$value',
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11.5, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}

/// What has actually been finished, over four windows — the website's own
/// breakdown, so the two agree.
class _Completed extends StatelessWidget {
  const _Completed({required this.summary});

  final TaskSummary summary;

  @override
  Widget build(BuildContext context) {
    final rows = <(String, int, Color)>[
      ('اليوم', summary.completedToday, AppColors.brandLight),
      ('هذا الأسبوع', summary.completedWeek, AppColors.info),
      ('هذا الشهر', summary.completedMonth, AppColors.purple),
      ('هذه السنة', summary.completedYear, AppColors.success),
    ];
    // Bars are relative to the largest window, so the year does not flatten
    // everything else into nothing.
    final most = rows.map((row) => row.$2).fold<int>(1, math.max);

    return TapCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0) const SizedBox(height: 14),
            Row(
              children: [
                SizedBox(
                  width: 78,
                  child: Text(
                    rows[i].$1,
                    style: TextStyle(
                      fontSize: 13,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ),
                Expanded(
                  child: TweenAnimationBuilder<double>(
                    tween: Tween(begin: 0, end: rows[i].$2 / most),
                    duration: Duration(milliseconds: 700 + i * 90),
                    curve: Curves.easeOutCubic,
                    builder: (context, value, _) => ClipRRect(
                      borderRadius: BorderRadius.circular(999),
                      child: LinearProgressIndicator(
                        value: value.clamp(0, 1),
                        minHeight: 8,
                        backgroundColor: AppColors.bgSurface2,
                        valueColor: AlwaysStoppedAnimation(rows[i].$3),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                SizedBox(
                  width: 30,
                  child: Text(
                    '${rows[i].$2}',
                    textAlign: TextAlign.end,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({
    required this.icon,
    required this.label,
    required this.value,
    this.chevron = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool chevron;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 19, color: AppColors.textSecondary),
        const SizedBox(width: 12),
        Text(
          label,
          style: TextStyle(fontSize: 14.5, color: AppColors.textSecondary),
        ),
        const Spacer(),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.end,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700),
          ),
        ),
        if (chevron) ...[
          const SizedBox(width: 4),
          Icon(Icons.chevron_left_rounded, size: 20, color: AppColors.textMuted),
        ],
      ],
    );
  }
}
