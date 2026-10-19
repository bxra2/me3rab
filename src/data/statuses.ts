export const TermStatus = {
  proposed: 'قيد النقاش',
  coined: 'مصكوك',
  agreed: 'متفق عليه',
  abandoned: 'مهجور',
} as const;

export type TermStatusKey = keyof typeof TermStatus;

export const statusBadgeClass: Record<TermStatusKey, string> = {
  proposed: 'badge-proposed',
  coined: 'badge-coined',
  agreed: 'badge-agreed',
  abandoned: 'badge-abandoned',
};
