import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import plugin from "./require-reduce-motion.js";

const rule = plugin.rules["require-reduce-motion"];

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("require-reduce-motion", () => {
  it("passes guarded animations and fails unguarded ones", () => {
    ruleTester.run("require-reduce-motion", rule, {
      valid: [
        // Guarded directly in the animated prop.
        `import { motion } from "framer-motion";
         const shouldReduceMotion = useAppReducedMotion();
         export const A = () => (
           <motion.div
             initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
             animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
           />
         );`,
        // Guard indirected through a local variable — file-level detection
        // must accept this (per-prop checks would false-positive here).
        `import { motion } from "framer-motion";
         const shouldReduceMotion = useAppReducedMotion();
         const anim = shouldReduceMotion ? {} : { scale: 1.05 };
         export const B = () => <motion.button whileHover={anim} whileTap={anim} />;`,
        // Guard used only in transition, exit gated via variants elsewhere.
        `import { motion } from "framer-motion";
         const shouldReduceMotion = useAppReducedMotion();
         export const C = () => (
           <motion.span exit={{ opacity: 0 }} transition={shouldReduceMotion ? { duration: 0 } : undefined} />
         );`,
        // Non-motion elements and motion elements without animation props are fine.
        `import { motion } from "framer-motion";
         export const D = () => (<div><motion.div className="x" layout /><section animate="yes" /></div>);`,
      ],
      invalid: [
        // Every supported animation prop is flagged when unguarded.
        ...["animate", "initial", "exit", "whileHover", "whileTap", "whileInView", "whileFocus", "whileDrag"].map(
          (prop) => ({
            code: `import { motion } from "framer-motion";
                   export const E = () => <motion.div ${prop}={{ opacity: 1 }} />;`,
            errors: [{ messageId: "missingGuard", data: { element: "div", prop } }],
          }),
        ),
        // A comment mentioning shouldReduceMotion does NOT count as a guard.
        {
          code: `import { motion } from "framer-motion";
                 // TODO: wire up shouldReduceMotion later
                 export const F = () => <motion.div animate={{ opacity: 1 }} />;`,
          errors: [{ messageId: "missingGuard" }],
        },
        // A string literal mentioning shouldReduceMotion does NOT count either.
        {
          code: `import { motion } from "framer-motion";
                 const note = "shouldReduceMotion";
                 export const G = () => <motion.div initial={{ opacity: 0 }} />;`,
          errors: [{ messageId: "missingGuard" }],
        },
        // Multiple unguarded props each get their own report.
        {
          code: `import { motion } from "framer-motion";
                 export const H = () => <motion.p initial={{ y: 4 }} animate={{ y: 0 }} exit={{ y: 4 }} />;`,
          errors: [
            { messageId: "missingGuard", data: { element: "p", prop: "initial" } },
            { messageId: "missingGuard", data: { element: "p", prop: "animate" } },
            { messageId: "missingGuard", data: { element: "p", prop: "exit" } },
          ],
        },
      ],
    });
  });
});
