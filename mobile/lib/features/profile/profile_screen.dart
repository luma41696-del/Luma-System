import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/app_theme.dart';
import '../../data/api.dart';
import '../../data/session.dart';

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
            child: const Text(
              'خروج',
              style: TextStyle(color: AppColors.danger),
            ),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    // The server address goes with the session: the next pairing decides it
    // again, so a phone handed to someone else keeps nothing.
    await LumaApi.instance.forget();
    await Session.instance.signOut();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.scaffold,
      body: ListenableBuilder(
        listenable: Session.instance,
        builder: (context, _) {
          final session = Session.instance;

          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 120),
            children: [
              SafeArea(
                bottom: false,
                child: Padding(
                  padding: const EdgeInsets.only(top: 16, bottom: 20),
                  child: Column(
                    children: [
                      CircleAvatar(
                        radius: 42,
                        backgroundColor: AppColors.limeTint,
                        foregroundImage: session.photoUrl?.isNotEmpty == true
                            ? NetworkImage(session.photoUrl!)
                            : null,
                        child: Text(
                          session.displayName.characters.take(1).toString(),
                          style: const TextStyle(
                            fontSize: 30,
                            fontWeight: FontWeight.w800,
                            color: AppColors.ink,
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                      Text(
                        session.displayName,
                        style: const TextStyle(
                          fontSize: 21,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (session.jobTitle.isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(
                          session.jobTitle,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 13.5,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              _Card(
                children: [
                  _Row(
                    icon: Icons.badge_outlined,
                    label: 'الدور',
                    value: session.isAdmin ? 'مدير النظام' : 'موظف',
                  ),
                  const Divider(height: 20),
                  _Row(
                    icon: Icons.key_outlined,
                    label: 'الصلاحيات',
                    value: session.isAdmin
                        ? 'كاملة'
                        : '${session.permissions.length}',
                  ),
                  const Divider(height: 20),
                  _Row(
                    icon: Icons.dns_outlined,
                    label: 'الخادم',
                    value: _host(LumaApi.instance.base),
                  ),
                ],
              ),
              const SizedBox(height: 22),
              OutlinedButton.icon(
                onPressed: () => _signOut(context),
                icon: const Icon(Icons.logout_rounded),
                label: const Text('تسجيل الخروج'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.danger,
                  minimumSize: const Size.fromHeight(52),
                  side: const BorderSide(color: AppColors.divider),
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
      ),
    );
  }

  static String _host(String? base) {
    if (base == null || base.isEmpty) return 'غير مرتبط';
    final host = Uri.tryParse(base)?.host;
    return host == null || host.isEmpty ? base : host;
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
      ),
      child: Column(children: children),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 19, color: AppColors.textSecondary),
        const SizedBox(width: 12),
        Text(
          label,
          style: const TextStyle(
            fontSize: 14.5,
            color: AppColors.textSecondary,
          ),
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
      ],
    );
  }
}
