export const TermStatus = {
    proposed: 'قيد النقاش',
    coined: 'مصكوك',
    agreed: 'متفق عليه',
    abandoned: 'مهجور',
} as const

export type TermStatusKey = keyof typeof TermStatus

export const statusBadgeClass: Record<TermStatusKey, string> = {
    proposed: 'badge-proposed',
    coined: 'badge-coined',
    agreed: 'badge-agreed',
    abandoned: 'badge-abandoned',
}

export const TermSource = {
    personal: 'اجتهاد شخصي',
    individual: 'اقتراح فردي',
    institutional: 'اقتراح مؤسسي',
    lexicographical: 'مصدر معجمي',
    heritage: 'مصدر تراثي',
    foreign: 'مصدر أجنبي',
    unknown: 'مجهول المصدر',
} as const

export type TermSourceKey = keyof typeof TermSource

export const sourceBadgeClass: Record<TermSourceKey, string> = {
    personal: 'source-personal',
    individual: 'source-individual',
    institutional: 'source-institutional',
    lexicographical: 'source-lexicographical',
    heritage: 'source-heritage',
    foreign: 'source-foreign',
    unknown: 'source-unknown',
}