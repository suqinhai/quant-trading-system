// ============================================================================
// ESLint 配置文件
// 为 TypeScript 量化交易系统提供代码质量检查
// ============================================================================

module.exports = {
  // 标记为根配置，ESLint 不会继续向上查找配置文件
  root: true,

  // === 解析器配置 ===
  // 使用 TypeScript 解析器来理解 TS 语法
  parser: '@typescript-eslint/parser',

  // 解析器选项
  parserOptions: {
    // 使用最新的 ECMAScript 语法
    ecmaVersion: 'latest',
    // 使用 ES 模块
    sourceType: 'module',
    // 指向 TypeScript 配置文件，用于类型感知的 lint 规则
    project: './tsconfig.json',
  },

  // === 插件配置 ===
  plugins: [
    // TypeScript 专用 lint 规则
    '@typescript-eslint',
    // 导入/导出语法检查
    'import',
  ],

  // === 继承配置 ===
  extends: [
    // ESLint 推荐规则
    'eslint:recommended',
    // TypeScript 推荐规则
    'plugin:@typescript-eslint/recommended',
    // TypeScript 严格类型检查规则
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    // 导入规则
    'plugin:import/recommended',
    'plugin:import/typescript',
    // Prettier 兼容配置（必须放在最后）
    'prettier',
  ],

  // === 环境配置 ===
  env: {
    // Node.js 全局变量
    node: true,
    // ES2022 全局变量
    es2022: true,
  },

  // === 规则配置 ===
  rules: {
    // === TypeScript 特定规则 ===

    // 强制使用类型导入语法，优化编译输出
    '@typescript-eslint/consistent-type-imports': [
      'error',
      {
        prefer: 'type-imports', // 优先使用 type 导入
        disallowTypeAnnotations: true, // 禁止在类型注解中使用值导入
      },
    ],

    // 强制使用类型导出语法
    '@typescript-eslint/consistent-type-exports': 'error',

    // 显式声明函数返回类型（提高代码可读性和类型安全）
    '@typescript-eslint/explicit-function-return-type': [
      'warn',
      {
        allowExpressions: true, // 允许表达式省略返回类型
        allowTypedFunctionExpressions: true, // 允许已类型化的函数表达式
      },
    ],

    // 强制类成员显式声明访问修饰符
    '@typescript-eslint/explicit-member-accessibility': [
      'error',
      {
        accessibility: 'explicit', // 必须显式声明
        overrides: {
          constructors: 'no-public', // 构造函数不需要 public
        },
      },
    ],

    // 禁止使用 any 类型（量化系统需要严格类型）
    '@typescript-eslint/no-explicit-any': 'error',

    // 禁止未使用的变量（但允许以下划线开头的变量）
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_', // 忽略以下划线开头的参数
        varsIgnorePattern: '^_', // 忽略以下划线开头的变量
      },
    ],

    // 禁止浮动的 Promise（必须处理 Promise）
    '@typescript-eslint/no-floating-promises': 'error',

    // 禁止滥用 Promise（如在不需要的地方使用 async）
    '@typescript-eslint/no-misused-promises': 'error',

    // 强制使用 nullish 合并操作符替代逻辑或
    '@typescript-eslint/prefer-nullish-coalescing': 'warn',

    // 强制使用可选链操作符
    '@typescript-eslint/prefer-optional-chain': 'warn',

    // 要求 switch 语句穷尽所有可能
    '@typescript-eslint/switch-exhaustiveness-check': 'error',

    // === 导入规则 ===

    // 导入排序规则
    'import/order': [
      'error',
      {
        groups: [
          'builtin', // Node.js 内置模块
          'external', // 外部依赖
          'internal', // 内部模块（@quant/*）
          'parent', // 父目录
          'sibling', // 同级目录
          'index', // 索引文件
          'type', // 类型导入
        ],
        // 每组之间添加空行
        'newlines-between': 'always',
        // 按字母排序
        alphabetize: {
          order: 'asc',
          caseInsensitive: true,
        },
      },
    ],

    // 禁止循环依赖
    'import/no-cycle': 'error',

    // 禁止默认导出（鼓励具名导出，提高代码可维护性）
    'import/prefer-default-export': 'off',
    'import/no-default-export': 'warn',

    // === 通用规则 ===

    // 强制使用 const（如果变量不会被重新赋值）
    'prefer-const': 'error',

    // 禁止使用 var
    'no-var': 'error',

    // 禁止使用 console（生产环境应使用专门的日志库）
    'no-console': ['warn', { allow: ['warn', 'error'] }],

    // 强制使用严格相等
    eqeqeq: ['error', 'always'],

    // 大括号风格
    curly: ['error', 'all'],
  },

  // === 设置 ===
  settings: {
    // 导入解析器设置
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true, // 总是尝试解析类型
        project: './tsconfig.json',
      },
    },
  },

  // === 忽略模式 ===
  ignorePatterns: [
    // 忽略编译输出
    'dist/',
    // 忽略依赖
    'node_modules/',
    // 忽略覆盖率报告
    'coverage/',
    // 忽略配置文件本身
    '*.config.js',
    '*.config.cjs',
  ],
};
