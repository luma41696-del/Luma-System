import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/app_theme.dart';
import '../../core/format.dart';
import '../../data/models/records.dart';
import '../../data/presence.dart';
import '../../data/repos.dart';
import '../../data/session.dart';
import '../../widgets/common.dart';
import '../../widgets/luma_image.dart';

class ChatThreadScreen extends StatefulWidget {
  const ChatThreadScreen({super.key, required this.chat});

  final Chat chat;

  @override
  State<ChatThreadScreen> createState() => _ChatThreadScreenState();
}

class _ChatThreadScreenState extends State<ChatThreadScreen> {
  final _controller = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final body = _controller.text.trim();
    if (body.isEmpty || _sending) return;

    setState(() => _sending = true);
    // Cleared straight away: waiting for the round trip makes the app feel
    // slow, and a failure puts the text back.
    _controller.clear();

    try {
      await Repos.instance.sendMessage(widget.chat.id, body);
    } on Object {
      if (!mounted) return;
      _controller.text = body;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text('تعذّر إرسال الرسالة.')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgApp,
      appBar: AppBar(
        backgroundColor: AppColors.bgApp,
        surfaceTintColor: Colors.transparent,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(
          widget.chat.name.isEmpty ? 'محادثة' : widget.chat.name,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: StreamBuilder<List<Message>>(
              stream: Repos.instance.messages(widget.chat.id),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return EmptyState(
                    icon: Icons.lock_outline_rounded,
                    title: 'لا تملك صلاحية قراءة هذه المحادثة',
                    tone: AppColors.warning,
                  );
                }
                if (!snapshot.hasData) {
                  return Center(
                    child: CircularProgressIndicator(color: AppColors.brand),
                  );
                }

                final messages = snapshot.data!;
                if (messages.isEmpty) {
                  return const EmptyState(
                    icon: Icons.chat_bubble_outline_rounded,
                    title: 'لا توجد رسائل بعد',
                    text: 'ابدأ المحادثة من الأسفل.',
                  );
                }

                // The query is newest-first and the list is reversed, so a
                // freshly opened thread already sits on the latest message.
                return ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  itemCount: messages.length,
                  itemBuilder: (context, i) => _Bubble(message: messages[i]),
                );
              },
            ),
          ),
          _Composer(
            controller: _controller,
            sending: _sending,
            onSend: _send,
          ),
        ],
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});

  final Message message;

  @override
  Widget build(BuildContext context) {
    final mine = message.senderId == Session.instance.uid;

    final bubble = ConstrainedBox(
      constraints: BoxConstraints(
        maxWidth: MediaQuery.sizeOf(context).width * .68,
      ),
      child: _Body(message: message, mine: mine),
    );

    if (mine) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          children: [bubble],
        ),
      );
    }

    // The other person's face beside their words, so a group thread can be
    // read without matching names to bubbles line by line.
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: FutureBuilder(
        future: Repos.instance.person(message.senderId),
        builder: (context, snapshot) {
          final name = snapshot.data?.name ?? '';

          return Row(
            mainAxisAlignment: MainAxisAlignment.end,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    if (name.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 3, right: 4, left: 4),
                        child: Text(
                          name,
                          style: TextStyle(
                            fontSize: 11.5,
                            color: AppColors.textMuted,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    bubble,
                  ],
                ),
              ),
              const SizedBox(width: 8),
              PresenceAvatar(
                uid: message.senderId,
                name: name,
                url: snapshot.data?.photoUrl,
                size: 32,
                ringColor: AppColors.bgApp,
              ),
            ],
          );
        },
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.message, required this.mine});

  final Message message;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    final at = message.createdAt;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: mine ? AppColors.brand : AppColors.bgSurface,
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(mine ? 18 : 4),
          bottomRight: Radius.circular(mine ? 4 : 18),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (message.attachment != null) ...[
            _Attachment(attachment: message.attachment!),
            if (message.body.isNotEmpty) const SizedBox(height: 8),
          ],
          if (message.body.isNotEmpty)
            Text(
              message.body,
              style: TextStyle(
                fontSize: 14.5,
                height: 1.55,
                color: mine ? AppColors.onBrand : AppColors.textPrimary,
              ),
            ),
          if (at != null) ...[
            const SizedBox(height: 4),
            Text(
              Fmt.ago(at),
              style: TextStyle(
                fontSize: 10.5,
                color: mine
                    ? AppColors.onBrand.withValues(alpha: .7)
                    : AppColors.textMuted,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// An image is shown; anything else is named. Tapping an image opens it full
/// screen, which is the only way to actually read a screenshot on a phone.
class _Attachment extends StatelessWidget {
  const _Attachment({required this.attachment});

  final Map<String, dynamic> attachment;

  @override
  Widget build(BuildContext context) {
    final url = attachment['url'] as String?;
    final name = (attachment['name'] as String?) ?? 'ملف';
    final type = (attachment['type'] as String?) ?? '';

    if (url == null || url.isEmpty) return const SizedBox.shrink();

    if (type.startsWith('image/')) {
      return GestureDetector(
        onTap: () => openImageViewer(context, url, name: name),
        child: Hero(
          tag: url,
          child: LumaImage(url: url, height: 190, width: double.infinity),
        ),
      );
    }

    return FileChip(name: name, size: attachment['size'] as num?);
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.sending,
    required this.onSend,
  });

  final TextEditingController controller;
  final bool sending;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
        decoration: BoxDecoration(
          color: AppColors.bgCanvas,
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                minLines: 1,
                maxLines: 4,
                textInputAction: TextInputAction.newline,
                style: const TextStyle(fontSize: 14.5),
                decoration: InputDecoration(
                  hintText: 'اكتب رسالة…',
                  hintStyle: TextStyle(color: AppColors.textMuted),
                  filled: true,
                  fillColor: AppColors.bgSurface,
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.chip),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            GestureDetector(
              onTap: sending ? null : onSend,
              child: Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: sending ? AppColors.bgSurface2 : AppColors.brand,
                  shape: BoxShape.circle,
                ),
                child: sending
                    ? Padding(
                        padding: EdgeInsets.all(13),
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppColors.textMuted,
                        ),
                      )
                    : Icon(Icons.send_rounded,
                        color: AppColors.onBrand, size: 20),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
