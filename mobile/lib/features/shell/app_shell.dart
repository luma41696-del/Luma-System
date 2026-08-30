import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../data/push.dart';
import '../../data/session.dart';
import '../home/home_screen.dart';
import '../notifications/notifications_screen.dart';
import '../profile/profile_screen.dart';
import '../tasks/task_detail_screen.dart';
import '../tasks/tasks_screen.dart';
import 'today_sheet.dart';

/// The four screens, behind the floating pill bar from the design.
class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _index = 0;

  @override
  void initState() {
    super.initState();
    // Push is started here rather than at launch: registering this device
    // needs a signed-in caller, and this screen only exists once there is one.
    Push.instance.start();
    WidgetsBinding.instance.addPostFrameCallback((_) => _openPendingTask());
  }

  /// If a notification was what opened the app, go where it pointed.
  void _openPendingTask() {
    final taskId = Push.instance.pendingTaskId;
    if (taskId == null || !mounted) return;
    Push.instance.pendingTaskId = null;
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => TaskDetailScreen(taskId: taskId)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBody: true,
      body: IndexedStack(
        index: _index,
        children: const [
          HomeScreen(),
          TasksScreen(),
          NotificationsScreen(),
          ProfileScreen(),
        ],
      ),
      bottomNavigationBar: _PillNav(
        index: _index,
        onSelect: (value) => setState(() => _index = value),
        onToday: () => showTodaySheet(context),
      ),
    );
  }
}

/// The dark floating pill with a raised centre button.
class _PillNav extends StatelessWidget {
  const _PillNav({
    required this.index,
    required this.onSelect,
    required this.onToday,
  });

  final int index;
  final ValueChanged<int> onSelect;
  final VoidCallback onToday;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      minimum: const EdgeInsets.only(bottom: 16),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            color: AppColors.ink,
            borderRadius: BorderRadius.circular(40),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: .25),
                blurRadius: 24,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _NavIcon(
                icon: Icons.home_rounded,
                label: 'الرئيسية',
                active: index == 0,
                onTap: () => onSelect(0),
              ),
              _NavIcon(
                icon: Icons.checklist_rounded,
                label: 'المهام',
                active: index == 1,
                onTap: () => onSelect(1),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                child: GestureDetector(
                  onTap: onToday,
                  child: Container(
                    width: 48,
                    height: 48,
                    decoration: const BoxDecoration(
                      color: AppColors.lime,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.bolt_rounded,
                      color: AppColors.ink,
                      size: 24,
                    ),
                  ),
                ),
              ),
              _UnreadDot(
                child: _NavIcon(
                  icon: Icons.notifications_rounded,
                  label: 'الإشعارات',
                  active: index == 2,
                  onTap: () => onSelect(2),
                ),
              ),
              _NavIcon(
                icon: Icons.person_rounded,
                label: 'حسابي',
                active: index == 3,
                onTap: () => onSelect(3),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavIcon extends StatelessWidget {
  const _NavIcon({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      selected: active,
      button: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: active ? Colors.white10 : Colors.transparent,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Icon(
            icon,
            size: 23,
            color: active ? AppColors.lime : Colors.white54,
          ),
        ),
      ),
    );
  }
}

/// A dot on the bell while anything is unread.
class _UnreadDot extends StatelessWidget {
  const _UnreadDot({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final uid = Session.instance.uid;
    if (uid.isEmpty) return child;

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance
          .collection('notifications')
          .where('userId', isEqualTo: uid)
          .where('read', isEqualTo: false)
          .limit(20)
          .snapshots(),
      builder: (context, snapshot) {
        final count = snapshot.data?.docs.length ?? 0;
        return Stack(
          clipBehavior: Clip.none,
          children: [
            child,
            if (count > 0)
              PositionedDirectional(
                top: 6,
                end: 8,
                child: Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(
                    color: AppColors.lime,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.ink, width: 1.5),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
