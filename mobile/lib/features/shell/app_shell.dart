import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../data/presence.dart';
import '../../data/push.dart';
import '../../data/session.dart';
import '../../widgets/pill_nav.dart';
import '../home/home_screen.dart';
import '../more/more_screen.dart';
import '../notifications/notifications_screen.dart';
import '../tasks/task_detail_screen.dart';
import '../tasks/tasks_screen.dart';
import 'today_sheet.dart';

/// The four tabs, behind the floating pill bar from the design.
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
    // Push starts here rather than at launch: registering this device needs a
    // signed-in caller, and this screen only exists once there is one.
    Push.instance.start();
    Presence.instance.start();
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
          MoreScreen(),
        ],
      ),
      bottomNavigationBar: _UnreadCount(
        builder: (unread) => PillNav(
          index: _index,
          onSelect: (value) => setState(() => _index = value),
          onCentre: () => showTodaySheet(context),
          centreIcon: Icons.bolt_rounded,
          centreLabel: 'تركيز اليوم',
          items: [
            const NavItem(icon: Icons.home_rounded, label: 'الرئيسية'),
            const NavItem(icon: Icons.checklist_rounded, label: 'المهام'),
            NavItem(
              icon: Icons.notifications_rounded,
              label: 'الإشعارات',
              badge: unread > 0,
            ),
            const NavItem(icon: Icons.grid_view_rounded, label: 'المزيد'),
          ],
        ),
      ),
    );
  }
}

/// Feeds the unread dot on the bell.
class _UnreadCount extends StatelessWidget {
  const _UnreadCount({required this.builder});

  final Widget Function(int unread) builder;

  @override
  Widget build(BuildContext context) {
    final uid = Session.instance.uid;
    if (uid.isEmpty) return builder(0);

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance
          .collection('notifications')
          .where('userId', isEqualTo: uid)
          .where('read', isEqualTo: false)
          .limit(20)
          .snapshots(),
      builder: (context, snapshot) => builder(snapshot.data?.docs.length ?? 0),
    );
  }
}
