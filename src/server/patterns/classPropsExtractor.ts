import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { PropDef } from "../../shared/types";

/**
 * Extracts static props = { ... } from a class body.
 * Handles:
 *   - Shorthand: propName: String  (Identifier value)
 *   - Full schema: propName: { type: String, optional: true, validate: fn }
 *   - Array types: propName: [String, Number]  (ArrayExpression of Identifiers)
 */
export function extractStaticProps(
  classNode: TSESTree.ClassDeclaration,
): Record<string, PropDef> {
  const props: Record<string, PropDef> = {};

  for (const member of classNode.body.body) {
    // PropertyDefinition with static === true and key.name === 'props'
    if (
      member.type === "PropertyDefinition" &&
      member.static === true &&
      member.key.type === "Identifier" &&
      member.key.name === "props" &&
      member.value !== null
    ) {
      const value = member.value;
      if (value.type !== "ObjectExpression") {
        continue;
      }

      for (const prop of value.properties) {
        if (prop.type !== "Property") {
          continue;
        }

        const keyName =
          prop.key.type === "Identifier"
            ? prop.key.name
            : prop.key.type === "Literal"
              ? String(prop.key.value)
              : null;

        if (!keyName) {
          continue;
        }

        const propValue = prop.value;

        if (propValue.type === "Identifier") {
          // Shorthand: propName: String
          props[keyName] = {
            type: propValue.name,
            optional: false,
            validate: false,
          };
        } else if (propValue.type === "ArrayExpression") {
          // Array type: propName: [String, Number]
          const typeNames = propValue.elements
            .filter(
              (el): el is TSESTree.Identifier =>
                el !== null && el.type === "Identifier",
            )
            .map((el) => el.name)
            .join(" | ");
          props[keyName] = {
            type: typeNames || "unknown",
            optional: false,
            validate: false,
          };
        } else if (propValue.type === "ObjectExpression") {
          // Full schema: propName: { type: String, optional: true, validate: fn }
          let type = "unknown";
          let optional = false;
          let validate = false;

          for (const schemaProp of propValue.properties) {
            if (schemaProp.type !== "Property") {
              continue;
            }
            const schemaKey =
              schemaProp.key.type === "Identifier" ? schemaProp.key.name : null;
            if (!schemaKey) {
              continue;
            }

            const schemaVal = schemaProp.value;
            if (schemaKey === "type") {
              if (schemaVal.type === "Identifier") {
                type = schemaVal.name;
              } else if (schemaVal.type === "ArrayExpression") {
                type = schemaVal.elements
                  .filter(
                    (el): el is TSESTree.Identifier =>
                      el !== null && el.type === "Identifier",
                  )
                  .map((el) => el.name)
                  .join(" | ");
              }
            } else if (schemaKey === "optional") {
              if (schemaVal.type === "Literal") {
                optional = Boolean(schemaVal.value);
              }
            } else if (schemaKey === "validate") {
              validate = true;
            }
          }

          props[keyName] = { type, optional, validate };
        }
      }
      break; // Only one static props definition expected
    }
  }

  return props;
}

/**
 * Extracts static template = "TemplateName" or static template = xml`...` from a class body.
 */
export function extractTemplateRef(
  classNode: TSESTree.ClassDeclaration,
): string | undefined {
  for (const member of classNode.body.body) {
    if (
      member.type === "PropertyDefinition" &&
      member.static === true &&
      member.key.type === "Identifier" &&
      member.key.name === "template" &&
      member.value !== null
    ) {
      const value = member.value;
      if (value.type === "Literal" && typeof value.value === "string") {
        return value.value;
      }
      // Tagged template: xml`TemplateName`
      if (value.type === "TaggedTemplateExpression") {
        const quasi = value.quasi;
        if (quasi.quasis.length > 0) {
          return quasi.quasis[0].value.cooked ?? quasi.quasis[0].value.raw;
        }
      }
      // Plain template literal
      if (value.type === "TemplateLiteral") {
        if (value.quasis.length > 0) {
          return value.quasis[0].value.cooked ?? value.quasis[0].value.raw;
        }
      }
    }
  }
  return undefined;
}
