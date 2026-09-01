import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/app_colors.dart';
import '../../core/app_theme.dart';
import '../../data/session.dart';
import '../../widgets/common.dart';

/// Editing your own details.
///
/// The fields here are exactly the ones the Security Rules let a person change
/// about themselves — phone, personal email, birthday, notes. Name, role,
/// permissions and salary are deliberately absent: those are management's to
/// set, and a form that offers them would only produce a rejected write and a
/// confused employee.
class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final _form = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _birthday = TextEditingController();
  final _notes = TextEditingController();

  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _phone.dispose();
    _email.dispose();
    _birthday.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final doc = await FirebaseFirestore.instance
          .collection('users')
          .doc(Session.instance.uid)
          .get();
      final data = doc.data() ?? const <String, dynamic>{};

      _phone.text = (data['phone'] as String?) ?? '';
      _email.text = (data['personalEmail'] as String?) ?? '';
      _birthday.text = (data['birthday'] as String?) ?? '';
      _notes.text = (data['personalNotes'] as String?) ?? '';
    } on Object {
      // An empty form is still usable; saving will report any real problem.
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false)) return;

    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);

    try {
      // Only the allowed keys, and only ever this user's own document — the
      // rules enforce both, and sending anything else would fail the write
      // outright rather than being ignored.
      await FirebaseFirestore.instance
          .collection('users')
          .doc(Session.instance.uid)
          .update({
        'phone': _phone.text.trim(),
        'personalEmail': _email.text.trim(),
        'birthday': _birthday.text.trim(),
        'personalNotes': _notes.text.trim(),
        'updatedAt': FieldValue.serverTimestamp(),
      });

      await Session.instance.refresh();
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text('تم حفظ التعديلات.')));
      navigator.pop();
    } on FirebaseException catch (error) {
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(
          content: Text(error.code == 'permission-denied'
              ? 'لا تملك صلاحية تعديل هذه الحقول.'
              : 'تعذّر الحفظ. حاول مرة أخرى.'),
        ));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return LumaPage(
      title: 'تعديل المعلومات',
      onBack: () => Navigator.of(context).pop(),
      child: _loading
          ? Center(child: CircularProgressIndicator(color: AppColors.brand))
          : Form(
              key: _form,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 40),
                children: [
                  _Field(
                    controller: _phone,
                    label: 'رقم الهاتف',
                    icon: Icons.phone_outlined,
                    keyboardType: TextInputType.phone,
                    // The rule caps this at 32 characters; stopping the typing
                    // is kinder than rejecting the save.
                    maxLength: 32,
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(r'[0-9+\-\s()]')),
                    ],
                  ),
                  _Field(
                    controller: _email,
                    label: 'البريد الشخصي',
                    icon: Icons.alternate_email_rounded,
                    keyboardType: TextInputType.emailAddress,
                    validator: (value) {
                      final text = value?.trim() ?? '';
                      if (text.isEmpty) return null;
                      return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(text)
                          ? null
                          : 'بريد غير صالح';
                    },
                  ),
                  _Field(
                    controller: _birthday,
                    label: 'تاريخ الميلاد',
                    icon: Icons.cake_outlined,
                    readOnly: true,
                    onTap: _pickBirthday,
                  ),
                  _Field(
                    controller: _notes,
                    label: 'ملاحظات شخصية',
                    icon: Icons.sticky_note_2_outlined,
                    maxLines: 4,
                    maxLength: 2000,
                  ),
                  const SizedBox(height: 8),
                  FilledButton.icon(
                    onPressed: _saving ? null : _save,
                    icon: _saving
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.check_rounded),
                    label: Text(_saving ? 'جارٍ الحفظ…' : 'حفظ'),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'الاسم والدور والصلاحيات يعدّلها مدير النظام من الموقع.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
    );
  }

  Future<void> _pickBirthday() async {
    final now = DateTime.now();
    final existing = DateTime.tryParse(_birthday.text);

    final picked = await showDatePicker(
      context: context,
      initialDate: existing ?? DateTime(now.year - 25),
      firstDate: DateTime(now.year - 80),
      lastDate: now,
      locale: const Locale('ar'),
    );
    if (picked == null) return;

    // Stored the way the website stores it, so both read the same value.
    setState(() {
      _birthday.text = '${picked.year.toString().padLeft(4, '0')}-'
          '${picked.month.toString().padLeft(2, '0')}-'
          '${picked.day.toString().padLeft(2, '0')}';
    });
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.controller,
    required this.label,
    required this.icon,
    this.keyboardType,
    this.maxLines = 1,
    this.maxLength,
    this.readOnly = false,
    this.onTap,
    this.validator,
    this.inputFormatters,
  });

  final TextEditingController controller;
  final String label;
  final IconData icon;
  final TextInputType? keyboardType;
  final int maxLines;
  final int? maxLength;
  final bool readOnly;
  final VoidCallback? onTap;
  final String? Function(String?)? validator;
  final List<TextInputFormatter>? inputFormatters;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: TextFormField(
        controller: controller,
        keyboardType: keyboardType,
        maxLines: maxLines,
        maxLength: maxLength,
        readOnly: readOnly,
        onTap: onTap,
        validator: validator,
        inputFormatters: inputFormatters,
        style: const TextStyle(fontSize: 14.5),
        decoration: InputDecoration(
          labelText: label,
          labelStyle: TextStyle(color: AppColors.textMuted),
          prefixIcon: Icon(icon, color: AppColors.textMuted, size: 20),
          filled: true,
          fillColor: AppColors.bgSurface,
          counterStyle: TextStyle(color: AppColors.textMuted, fontSize: 11),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.tile),
            borderSide: BorderSide.none,
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.tile),
            borderSide: BorderSide(color: AppColors.brand, width: 1.6),
          ),
        ),
      ),
    );
  }
}
