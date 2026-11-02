export const TermStatus = {
    proposed: 'قيد النقاش',
    coined: 'مصكوك',
    agreed: 'متفق عليه',
    abandoned: 'مهجور',
} as const

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

export const sourceBadgeClass: Record<TermSourceKey, string> = {
    personal: 'source-personal',
    individual: 'source-individual',
    institutional: 'source-institutional',
    lexicographical: 'source-lexicographical',
    heritage: 'source-heritage',
    foreign: 'source-foreign',
    unknown: 'source-unknown',
}
export const TermMotivation = {
    noEquivalent: 'انعدام المقابل',
    ambiguity: 'اللبس الاصطلاحي',
    lackOfPrecision: 'نقص الدقة',
    multipleEquivalents: 'تعدد المقابلات',
    inadequateEquivalent: 'قصور المقابل',
    mistranslation: 'سوء الترجمة',
    linguisticInadequacy: 'ضعف الملاءمة اللغوية',
    difficultyOfUse: 'صعوبة الاستخدام',
    standardization: 'التوحيد الاصطلاحي',
} as const

export const motivationBadgeClass: Record<TermMotivationKey, string> = {
    noEquivalent: 'motivation-no-equivalent',
    ambiguity: 'motivation-ambiguity',
    lackOfPrecision: 'motivation-lack-of-precision',
    multipleEquivalents: 'motivation-multiple-equivalents',
    inadequateEquivalent: 'motivation-inadequate-equivalent',
    mistranslation: 'motivation-mistranslation',
    linguisticInadequacy: 'motivation-linguistic-inadequacy',
    difficultyOfUse: 'motivation-difficulty-of-use',
    standardization: 'motivation-standardization',
}

export const TermFormation = {
    derivation: 'الاشتقاق',
    blending: 'النحت',
    arabization: 'التعريب',
    borrowing: 'الاقتراض',
    literalTranslation: 'الترجمة الحرفية',
    semanticTranslation: 'الترجمة الدلالية',
    revival: 'إحياء لفظ مهجور',
    semanticShift: 'النقل الدلالي',
    compounding: 'التركيب',
    reformulation: 'إعادة الصياغة',
} as const

export const formationBadgeClass: Record<TermFormationKey, string> = {
    derivation: 'formation-derivation',
    blending: 'formation-blending',
    arabization: 'formation-arabization',
    borrowing: 'formation-borrowing',
    literalTranslation: 'formation-literal-translation',
    semanticTranslation: 'formation-semantic-translation',
    revival: 'formation-revival',
    semanticShift: 'formation-semantic-shift',
    compounding: 'formation-compounding',
    reformulation: 'formation-reformulation',
}
export type TermStatusKey = keyof typeof TermStatus
export type TermSourceKey = keyof typeof TermSource
export type TermMotivationKey = keyof typeof TermMotivation
export type TermFormationKey = keyof typeof TermFormation
