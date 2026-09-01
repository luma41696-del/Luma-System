import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../data/models/records.dart';
import '../../data/presence.dart';
import '../../data/repos.dart';
import '../../widgets/common.dart';

class TeamScreen extends StatefulWidget {
  const TeamScreen({super.key});

  @override
  State<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends State<TeamScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    return LumaPage(
      title: 'الفريق',
      onBack: () => Navigator.of(context).pop(),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
            child: TextField(
              onChanged: (value) => setState(() => _query = value.trim()),
              style: const TextStyle(fontSize: 14.5),
              decoration: InputDecoration(
                hintText: 'ابحث بالاسم أو القسم…',
                hintStyle: TextStyle(color: AppColors.textMuted),
                prefixIcon:
                    Icon(Icons.search_rounded, color: AppColors.textMuted),
                filled: true,
                fillColor: AppColors.bgSurface,
                contentPadding: const EdgeInsets.symmetric(vertical: 14),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(999),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          Expanded(
            // One subscription for the whole directory, handed down to the rows.
            child: StreamBuilder<Map<String, WorkState>>(
              stream: Presence.instance.everyone(),
              builder: (context, presence) => StreamBuilder<List<Member>>(
              stream: Repos.instance.team(),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return EmptyState(
                    icon: Icons.lock_outline_rounded,
                    title: 'لا تملك صلاحية عرض الفريق',
                    tone: AppColors.warning,
                  );
                }
                if (!snapshot.hasData) {
                  return Center(
                    child: CircularProgressIndicator(color: AppColors.brand),
                  );
                }

                final needle = _query.toLowerCase();
                final people = snapshot.data!
                    .where((m) =>
                        needle.isEmpty ||
                        m.name.toLowerCase().contains(needle) ||
                        m.department.toLowerCase().contains(needle) ||
                        m.jobTitle.toLowerCase().contains(needle))
                    .toList();

                if (people.isEmpty) {
                  return EmptyState(
                    icon: Icons.person_search_rounded,
                    title: _query.isEmpty ? 'لا يوجد أعضاء' : 'لا نتائج',
                    text: _query.isEmpty ? null : 'جرّب كلمة أخرى.',
                  );
                }

                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 120),
                  itemCount: people.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (context, i) => _MemberRow(
                    member: people[i],
                    state: presence.data?[people[i].id] ?? WorkState.offline,
                  ),
                );
              },
            ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MemberRow extends StatelessWidget {
  const _MemberRow({required this.member, required this.state});

  final Member member;
  final WorkState state;

  @override
  Widget build(BuildContext context) {
    final detail = [
      if (member.jobTitle.isNotEmpty) member.jobTitle,
      if (member.department.isNotEmpty) member.department,
    ].join('  ·  ');

    return TapCard(
      child: Row(
        children: [
          Opacity(
            opacity: member.isActive ? 1 : .45,
            child: PresenceAvatar(
              uid: member.id,
              name: member.name,
              url: member.photoUrl,
              size: 44,
              state: state,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  member.name.isEmpty ? 'بدون اسم' : member.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (detail.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    detail,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12.5,
                      color: AppColors.textMuted,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (!member.isActive)
            Pill(label: 'غير نشط', color: AppColors.grey),
        ],
      ),
    );
  }
}
