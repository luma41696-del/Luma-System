import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/format.dart';
import '../../data/models/records.dart';
import '../../data/presence.dart';
import '../../data/repos.dart';
import '../../data/session.dart';
import '../../widgets/common.dart';
import 'chat_thread_screen.dart';

class ChatsScreen extends StatelessWidget {
  const ChatsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return LumaPage(
      title: 'المحادثات',
      onBack: () => Navigator.of(context).pop(),
      child: StreamList<Chat>(
        stream: Repos.instance.myChats(),
        empty: const EmptyState(
          icon: Icons.forum_rounded,
          title: 'لا توجد محادثات',
          text: 'المحادثات التي تُضاف إليها ستظهر هنا.',
        ),
        itemBuilder: (context, chat) => _ChatRow(chat: chat),
      ),
    );
  }
}

class _ChatRow extends StatelessWidget {
  const _ChatRow({required this.chat});

  final Chat chat;

  @override
  Widget build(BuildContext context) {
    final at = chat.lastMessageAt;

    return TapCard(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => ChatThreadScreen(chat: chat)),
      ),
      child: Row(
        children: [
          _Face(chat: chat),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: _Title(chat: chat),
                    ),
                    if (at != null)
                      Text(
                        Fmt.ago(at),
                        style: TextStyle(
                          fontSize: 11.5,
                          color: AppColors.textMuted,
                        ),
                      ),
                  ],
                ),
                if (chat.lastMessage.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    chat.lastMessage,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13,
                      color: AppColors.textMuted,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A direct chat gets the other person's avatar and presence; a group gets its
/// icon, because "who is online" means nothing for twenty people.
class _Face extends StatelessWidget {
  const _Face({required this.chat});

  final Chat chat;

  @override
  Widget build(BuildContext context) {
    if (!chat.isDirect) {
      return Container(
        width: 46,
        height: 46,
        decoration: BoxDecoration(
          color: AppColors.brand.withValues(alpha: .16),
          borderRadius: BorderRadius.circular(15),
        ),
        child: Icon(chat.icon, color: AppColors.brandLight, size: 22),
      );
    }

    final other = chat.members.firstWhere(
      (id) => id != Session.instance.uid,
      orElse: () => '',
    );

    return FutureBuilder(
      future: Repos.instance.person(other),
      builder: (context, snapshot) => PresenceAvatar(
        uid: other,
        name: snapshot.data?.name ?? '',
        url: snapshot.data?.photoUrl,
        size: 46,
      ),
    );
  }
}

/// A direct chat usually has no name of its own — it is named after the other
/// person, so that has to be looked up rather than shown as "محادثة".
class _Title extends StatelessWidget {
  const _Title({required this.chat});

  final Chat chat;

  @override
  Widget build(BuildContext context) {
    const style = TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700);

    if (chat.name.isNotEmpty) {
      return Text(chat.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: style);
    }

    if (!chat.isDirect) {
      return const Text('محادثة', style: style);
    }

    final other = chat.members.firstWhere(
      (id) => id != Session.instance.uid,
      orElse: () => '',
    );

    return FutureBuilder(
      future: Repos.instance.person(other),
      builder: (context, snapshot) => Text(
        snapshot.data?.name ?? 'محادثة',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: style,
      ),
    );
  }
}
