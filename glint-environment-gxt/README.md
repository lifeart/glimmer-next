# `glint-environment-gxt`

This package contains the information necessary for glint to typecheck an `ember-template-imports` project.

Note that this environment should be installed alongside `@glint/environment-ember-loose` and both should be activated
in your Glint configuration in `tsconfig.json`:

```javascript
{
  "compilerOptions": { /* ... */ },
  "glint": {
    "environment": [
      "ember-loose",
      "glint-environment-gxt"
    ]
  }
}
```
