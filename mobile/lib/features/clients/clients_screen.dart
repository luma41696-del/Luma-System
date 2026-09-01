import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/format.dart';
import '../../data/models/records.dart';
import '../../data/repos.dart';
import '../../widgets/common.dart';

class ClientsScreen extends StatelessWidget {
  const ClientsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return LumaPage(
      title: 'العملاء',
      onBack: () => Navigator.of(context).pop(),
      child: StreamList<Client>(
        stream: Repos.instance.clients(),
        empty: const EmptyState(
          icon: Icons.apartment_rounded,
          title: 'لا يوجد عملاء',
        ),
        itemBuilder: (context, client) => TapCard(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => ClientDetailScreen(id: client.id, initial: client),
            ),
          ),
          child: Row(
            children: [
              Avatar(name: client.name, url: client.logoUrl, size: 46),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      client.name.isEmpty ? 'بدون اسم' : client.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (client.contactPerson.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(
                        client.contactPerson,
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
              const SizedBox(width: 8),
              Pill(label: client.statusLabel, color: client.statusColor),
            ],
          ),
        ),
      ),
    );
  }
}

class ClientDetailScreen extends StatelessWidget {
  const ClientDetailScreen({super.key, required this.id, this.initial});

  final String id;
  final Client? initial;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<Client>(
      stream: Repos.instance.client(id),
      initialData: initial,
      builder: (context, snapshot) {
        final client = snapshot.data;

        return LumaPage(
          title: client?.name.isNotEmpty == true ? client!.name : 'العميل',
          onBack: () => Navigator.of(context).pop(),
          child: client == null
              ? Center(
                  child: CircularProgressIndicator(color: AppColors.brand))
              : ListView(
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 40),
                  children: [
                    Center(
                      child: Avatar(
                        name: client.name,
                        url: client.logoUrl,
                        size: 92,
                      ),
                    ),
                    const SizedBox(height: 18),
                    Center(
                      child: Pill(
                        label: client.statusLabel,
                        color: client.statusColor,
                        icon: Icons.circle,
                      ),
                    ),
                    const SizedBox(height: 24),
                    _Facts(client: client),
                    if (client.services.isNotEmpty) ...[
                      const SizedBox(height: 20),
                      const Text(
                        'الخدمات',
                        style: TextStyle(
                          fontSize: 15.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final service in client.services)
                            Pill(label: service, color: AppColors.brandLight),
                        ],
                      ),
                    ],
                  ],
                ),
        );
      },
    );
  }
}

class _Facts extends StatelessWidget {
  const _Facts({required this.client});

  final Client client;

  @override
  Widget build(BuildContext context) {
    final rows = <(IconData, String, String)>[
      if (client.contactPerson.isNotEmpty)
        (Icons.person_outline_rounded, 'مسؤول التواصل', client.contactPerson),
      if (client.phone.isNotEmpty) (Icons.phone_outlined, 'الهاتف', client.phone),
      if (client.email.isNotEmpty) (Icons.mail_outline_rounded, 'البريد', client.email),
      if (client.contractEnd != null)
        (Icons.event_outlined, 'نهاية العقد', Fmt.date(client.contractEnd!)),
    ];

    if (rows.isEmpty) {
      return TapCard(
        child: Text(
          'لا توجد تفاصيل إضافية مسجّلة لهذا العميل.',
          style: TextStyle(color: AppColors.textMuted, fontSize: 13.5),
        ),
      );
    }

    return TapCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0) const Divider(height: 22),
            Row(
              children: [
                Icon(rows[i].$1, size: 19, color: AppColors.textMuted),
                const SizedBox(width: 12),
                Text(
                  rows[i].$2,
                  style: TextStyle(
                    fontSize: 14,
                    color: AppColors.textSecondary,
                  ),
                ),
                const Spacer(),
                Flexible(
                  child: Text(
                    rows[i].$3,
                    textAlign: TextAlign.end,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
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
