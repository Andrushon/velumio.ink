/**
 * Custom ESLint rule: require-reduce-motion
 *
 * Flags `<motion.*>` JSX elements that use framer-motion animation props
 * (`animate`, `initial`, `exit`, `whileHover`, `whileTap`, `whileInView`,
 * `whileFocus`, `whileDrag`) in files that contain no real
 * `shouldReduceMotion` identifier. This catches brand-new pages/components
 * that ship inline animations without a reduce-motion guard.
 *
 * Granularity is deliberately FILE-LEVEL: the app convention is one
 * `const shouldReduceMotion = useAppReducedMotion();` per file, with gating
 * expressions often indirected through local variables, variants objects, or
 * `transition` props — so per-prop enforcement would false-positive on
 * legitimately guarded code. A file that animates but never binds or
 * references the `shouldReduceMotion` identifier cannot be honoring the
 * preference, which is exactly the regression this rule targets.
 *
 * Guard detection is AST-based (Identifier nodes only), so mentions of
 * "shouldReduceMotion" in comments or string literals do NOT count.
 *
 * Pre-existing offenders are exempted via a baseline block in
 * eslint.config.js — do NOT add new files there; guard them instead.
 */

const ANIMATION_PROPS = new Set([
  "animate",
  "initial",
  "exit",
  "whileHover",
  "whileTap",
  "whileInView",
  "whileFocus",
  "whileDrag",
]);

const GUARD_NAME = "shouldReduceMotion";

/** True when the JSX element name is `motion.<something>` (e.g. motion.div). */
function isMotionElement(name) {
  return (
    name &&
    name.type === "JSXMemberExpression" &&
    name.object &&
    name.object.type === "JSXIdentifier" &&
    name.object.name === "motion"
  );
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "require a shouldReduceMotion identifier in files where <motion.*> elements use animation props",
    },
    schema: [],
    messages: {
      missingGuard:
        "<motion.{{element}}> uses the '{{prop}}' prop, but this file never references " +
        "the '" +
        GUARD_NAME +
        "' identifier. Call `const shouldReduceMotion = useAppReducedMotion()` " +
        "(from @/hooks/useAppReducedMotion) and gate animated props with it, e.g. " +
        "`animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}`.",
    },
  },

  create(context) {
    let guardFound = false;
    /** @type {Array<{node: import("estree").Node, element: string, prop: string}>} */
    const pending = [];

    return {
      // Any real identifier named shouldReduceMotion — a declaration
      // (`const shouldReduceMotion = ...`), a reference inside an expression,
      // a destructured prop, etc. Comments and string literals are not
      // Identifier nodes and therefore never count.
      Identifier(node) {
        if (node.name === GUARD_NAME) guardFound = true;
      },

      JSXOpeningElement(node) {
        if (!isMotionElement(node.name)) return;
        for (const attr of node.attributes) {
          if (
            attr.type === "JSXAttribute" &&
            attr.name &&
            attr.name.type === "JSXIdentifier" &&
            ANIMATION_PROPS.has(attr.name.name)
          ) {
            pending.push({
              node: attr,
              element: node.name.property ? node.name.property.name : "*",
              prop: attr.name.name,
            });
          }
        }
      },

      "Program:exit"() {
        if (guardFound) return;
        for (const report of pending) {
          context.report({
            node: report.node,
            messageId: "missingGuard",
            data: { element: report.element, prop: report.prop },
          });
        }
      },
    };
  },
};

export default {
  rules: {
    "require-reduce-motion": rule,
  },
};
