# Recipe Flow Implementation Guide

**Created:** January 20, 2026
**Status:** Complete ✅

## Overview

This document describes the AI-powered **Recipe Flow Orchestration System** built for the Simple House app. The system provides intelligent, conversational interfaces for:

1. **Recipe Creation** - AI-guided recipe crafting with ingredient extraction and nutrition analysis
2. **Meal Logging** - Track meals with automatic nutrition calculation
3. **Water Logging** - Hydration tracking with daily goals

## Architecture

### 1. Conversation Flow Orchestrator

**File:** [`backend/src/services/conversation-flow-orchestrator.ts`](backend/src/services/conversation-flow-orchestrator.ts)

The orchestrator is the brain of the recipe flow system. It:

- **Detects user intent** using Claude AI (create recipe, log meal, log water)
- **Manages multi-stage conversations** with state tracking
- **Collects mandatory data** progressively through natural conversation
- **Validates and confirms** information with users
- **Integrates with Claude AI** for ingredient extraction and nutrition enrichment

#### Key Features

```typescript
// Flow Types
type FlowType = 'create_recipe' | 'log_meal' | 'log_water' | 'none';

// Stages for Recipe Creation
type FlowStage =
  | 'detect_intent'          // Initial: What does the user want?
  | 'collect_ingredients'     // Extract ingredients from message
  | 'confirm_ingredients'     // Show nutrition card, ask for confirmation
  | 'collect_recipe_name'     // Get recipe name + prep/cook time
  | 'collect_cooking_method'  // Detect cooking method
  | 'collect_servings'        // How many servings?
  | 'finalize_recipe'         // Save to database
  | 'completed';              // Done!
```

#### Cooking Methods

The system supports automatic detection of cooking methods:

```typescript
export const COOKING_METHODS = {
  BAKING: 'Baking',
  BOILING: 'Boiling',
  FRYING: 'Frying',
  GRILLING: 'Grilling',
  STEAMING: 'Steaming',
  ROASTING: 'Roasting',
  SAUTEING: 'Sautéing',
  MIXED: 'Mixed', // Default fallback
} as const;
```

If the system cannot determine the method, it defaults to **"Mixed"** with a ratio of `{ Mixed: 1 }`.

### 2. Recipe Service

**File:** [`backend/src/services/recipe-service.ts`](backend/src/services/recipe-service.ts)

Handles database operations for recipes, meals, and water logs.

**Key Methods:**

- `createRecipe()` - Create recipe with ingredients and nutrition
- `getRecipe()` - Fetch recipe with full details
- `listRecipes()` - List recipes with filtering (favorites, search)
- `updateRecipe()` - Update recipe fields and ingredients
- `deleteRecipe()` - Soft delete recipe
- `toggleFavorite()` - Mark/unmark as favorite
- `logMeal()` - Log meal consumption with nutrition snapshot
- `logWater()` - Log water intake
- `getDailyNutritionSummary()` - Get daily nutrition totals

### 3. Database Schema

**Migration:** [`backend/migrations/0004_recipe_meal_water_tracking.sql`](backend/migrations/0004_recipe_meal_water_tracking.sql)

**Tables:**

#### `recipes`
- Recipe metadata (name, times, servings, cooking method)
- Nutrition totals (calories, macros per serving)
- Tags, instructions, notes
- Favorite flag

#### `recipe_ingredients`
- Ingredient list with quantities and units
- Per-ingredient nutrition (calories, protein, carbs, fat, fiber, sugar, sodium)
- AI confidence scores

#### `meal_logs`
- Meal consumption records
- Links to recipes or custom meal names
- Nutrition snapshot at time of logging
- Meal type (breakfast, lunch, dinner, snack)

#### `water_logs`
- Water intake records (ml)
- Timestamp and notes

#### `nutrition_goals`
- Per-user daily nutrition goals
- Calorie, macro, and water targets

### 4. API Routes

**File:** [`backend/src/routes/recipes.ts`](backend/src/routes/recipes.ts)

#### Recipe Management

```http
POST   /households/:householdId/recipes/chat
  - AI-powered conversational interface
  - Body: { message: string, sessionId?: string }
  - Returns: { response, sessionId, flowType, stage, suggestedActions }

POST   /households/:householdId/recipes
  - Create recipe manually (skip AI flow)
  - Body: CreateRecipeParams

GET    /households/:householdId/recipes
  - List recipes
  - Query: limit, offset, favorites, search

GET    /households/:householdId/recipes/:recipeId
  - Get single recipe with ingredients

PATCH  /households/:householdId/recipes/:recipeId
  - Update recipe

DELETE /households/:householdId/recipes/:recipeId
  - Soft delete recipe

POST   /households/:householdId/recipes/:recipeId/favorite
  - Toggle favorite status
```

#### Meal & Water Logging

```http
POST   /households/:householdId/meals
  - Log meal consumption
  - Body: { recipeId?, mealName?, mealType?, quantity, loggedAt?, notes? }

POST   /households/:householdId/water
  - Log water intake
  - Body: { amountMl, loggedAt?, notes? }

GET    /households/:householdId/nutrition/daily/:date
  - Get daily nutrition summary (YYYY-MM-DD)
  - Returns: totalCalories, macros, water, meals[], waterLogs[]
```

## AI Integration

### Intent Detection

When a user sends a message, Claude AI analyzes it to determine intent:

```
"I want to log a recipe" → create_recipe
"Add chicken and rice recipe" → create_recipe
"I ate 200g pasta" → log_meal
"Drank 500ml water" → log_water
"What's for dinner?" → none (general chat)
```

### Ingredient Extraction

The AI parses natural language to extract structured ingredients:

**User Input:**
> "2 chicken breasts, 1 cup rice, 3 cloves garlic"

**AI Output:**
```json
[
  { "name": "chicken breast", "quantity": 2, "unit": "pieces" },
  { "name": "rice", "quantity": 1, "unit": "cup" },
  { "name": "garlic", "quantity": 3, "unit": "cloves" }
]
```

### Nutrition Enrichment

For each ingredient, the AI estimates nutrition using Claude's knowledge:

```json
{
  "name": "chicken breast",
  "nutrition": {
    "calories": 165,
    "protein": 31,
    "carbs": 0,
    "fat": 3.6,
    "fiber": 0,
    "sugar": 0,
    "confidence": 0.9
  }
}
```

**Note:** In production, integrate with USDA FoodData Central API or similar for accurate nutrition data.

### Recipe Name & Time Parsing

The AI extracts recipe metadata from conversational input:

**User Input:**
> "Grilled Chicken with Rice, takes 15 min prep and 30 min cooking"

**AI Output:**
```json
{
  "name": "Grilled Chicken with Rice",
  "prepTime": 15,
  "cookTime": 30
}
```

## Recipe Creation Flow (Example)

### Step 1: User Initiates

```
User: "I want to create a recipe with chicken and vegetables"
```

**System:**
- Detects intent: `create_recipe`
- Stage: `collect_ingredients`
- Extracts ingredients from message

### Step 2: Ingredient Confirmation

**AI Response:**
```
📋 Ingredients Detected:

1. chicken -
   🔥 165 cal | 🥩 31g protein | 🍞 0g carbs | 🥑 3.6g fat

2. vegetables -
   🔥 50 cal | 🥩 2g protein | 🍞 10g carbs | 🥑 0.5g fat

Does this look correct?
```

**Suggested Actions:** `✅ Confirm ingredients`, `✏️ Edit ingredients`, `❌ Start over`

### Step 3: Confirm or Edit

```
User: "Yes, looks good"
```

**System:**
- Stage: `collect_recipe_name`

**AI Response:**
```
Great! Now, what would you like to name this recipe?
Also, how long does it take to prepare and cook?
```

### Step 4: Recipe Name & Times

```
User: "Grilled Chicken with Veggies, 10 min prep, 20 min cook"
```

**System:**
- Parses: name = "Grilled Chicken with Veggies", prepTime = 10, cookTime = 20
- Stage: `collect_cooking_method`

**AI Response:**
```
Got it! Recipe: "Grilled Chicken with Veggies".
How is this dish cooked?
```

**Suggested Actions:** `Baking`, `Frying`, `Boiling`, `Grilling`, `Mixed`

### Step 5: Cooking Method

```
User: "Grilling"
```

**System:**
- Detects: `Grilling`
- Stage: `collect_servings`

**AI Response:**
```
Cooking method: Grilling. How many servings does this recipe make?
```

**Suggested Actions:** `1 serving`, `2 servings`, `4 servings`, `6 servings`

### Step 6: Servings

```
User: "4 servings"
```

**System:**
- Stage: `finalize_recipe`
- Saves to database
- Calculates per-serving nutrition

**AI Response:**
```
✅ Recipe Created Successfully!

📝 Grilled Chicken with Veggies
👨‍🍳 Cooking Method: Grilling
⏱️ Prep: 10 min | Cook: 20 min
🍽️ Servings: 4
🔥 Total Calories: ~860 cal (215 per serving)

Recipe ID: recipe_1737408000123
```

## Mandatory Data Collection

The orchestrator ensures ALL required data is collected:

### Recipe Creation Requirements

1. ✅ **Ingredients** - Extracted from message or asked explicitly
2. ✅ **Nutrition** - Fetched via AI smart search, shown in confirmation card
3. ✅ **Recipe Name** - Asked explicitly
4. ✅ **Prep & Cook Time** - Asked with recipe name (defaults if not provided)
5. ✅ **Cooking Method** - Parsed from methods list, defaults to "Mixed"
6. ✅ **Servings** - Asked explicitly

The AI **will not proceed** to the next stage until the current data is collected.

## Best AI Practices Applied

### 1. Intent Detection
- Uses Claude's reasoning to understand user goals
- Supports multiple phrasings ("log recipe", "add recipe", "create recipe")

### 2. Multi-Turn Conversations
- State tracked across messages with `sessionId`
- Conversation history preserved for context

### 3. Progressive Data Collection
- Asks one thing at a time
- Clear stage progression
- User-friendly prompts

### 4. Confirmation Loops
- Shows extracted data before proceeding
- Allows corrections without restarting
- Visual formatting (emojis, nutrition cards)

### 5. Smart Defaults
- Mixed cooking method if uncertain
- Reasonable prep/cook times if not specified
- Default servings: 2

### 6. Structured Output
- AI returns JSON for parsing
- Fallback to regex extraction if JSON malformed
- Error handling with graceful degradation

### 7. Context-Aware Prompts
- Different prompts for each stage
- Suggested actions guide user
- Clear instructions

### 8. Validation
- User has access to household verified
- Data types validated before database insert
- Foreign key constraints enforced

## Integration Points

### Frontend Integration

**Example: React Native Chat Component**

```typescript
const [sessionId, setSessionId] = useState<string>();
const [messages, setMessages] = useState<Message[]>([]);

async function sendMessage(text: string) {
  const response = await fetch(
    `/households/${householdId}/recipes/chat`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: text, sessionId }),
    }
  );

  const data = await response.json();

  setSessionId(data.sessionId);
  setMessages([
    ...messages,
    { role: 'user', content: text },
    { role: 'assistant', content: data.response },
  ]);

  // Show suggested actions
  if (data.suggestedActions) {
    showQuickReplies(data.suggestedActions);
  }
}
```

### Database Migration

Run the migration:

```bash
cd backend
npx drizzle-kit push:sqlite
```

Or apply manually:

```bash
wrangler d1 execute simple-house-db --local --file=./migrations/0004_recipe_meal_water_tracking.sql
```

### Environment Variables

Ensure these are set in `wrangler.toml`:

```toml
[vars]
ANTHROPIC_API_KEY = "your-claude-api-key"
```

## Extending the System

### Adding New Flows

1. Add new `FlowType` to orchestrator
2. Implement handler method (e.g., `handleExerciseLogFlow()`)
3. Add intent detection keywords
4. Define stages and data collection

### Custom Nutrition API

Replace the AI nutrition estimation with real data:

```typescript
private async enrichIngredientsWithNutrition(ingredients) {
  for (const ing of ingredients) {
    const nutrition = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${ing.name}`,
      { headers: { 'X-Api-Key': this.env.USDA_API_KEY } }
    );
    ing.nutrition = parseUSDAResponse(nutrition);
  }
}
```

### Adding Photo Upload

Update `recipes` table and add R2 upload:

```typescript
async uploadRecipePhoto(recipeId: string, file: File) {
  const key = `recipes/${recipeId}/${Date.now()}.jpg`;
  await this.env.RECIPE_PHOTOS_BUCKET.put(key, file);
  await this.db.update(schema.recipes)
    .set({ photo_key: key })
    .where(eq(schema.recipes.id, recipeId));
}
```

## Testing

### Manual Testing

**Create Recipe via AI:**

```bash
curl -X POST https://api.simplehouse.app/households/hh_123/recipes/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I want to log a recipe with 2 chicken breasts and 1 cup rice"
  }'
```

**Check Session State:**

```bash
# Continue conversation with sessionId from previous response
curl -X POST https://api.simplehouse.app/households/hh_123/recipes/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Yes, confirm ingredients",
    "sessionId": "session_1737408000_abc123"
  }'
```

### Automated Tests

```typescript
describe('Recipe Flow Orchestrator', () => {
  it('should detect create_recipe intent', async () => {
    const result = await orchestrator.processMessage({
      userId: 'user_1',
      householdId: 'hh_1',
      message: 'I want to create a recipe',
    });

    expect(result.flowState.flowType).toBe('create_recipe');
  });

  it('should extract ingredients', async () => {
    const result = await orchestrator.processMessage({
      userId: 'user_1',
      householdId: 'hh_1',
      message: 'chicken, rice, garlic',
      sessionId: 'test_session',
    });

    expect(result.flowState.data.parsedIngredients).toHaveLength(3);
  });
});
```

## Troubleshooting

### Issue: AI not detecting ingredients

**Solution:** Ensure ingredients are clearly listed. Try comma-separated format.

**Example:**
- ❌ "I have some stuff in the fridge"
- ✅ "2 chicken breasts, 1 cup rice, 3 garlic cloves"

### Issue: Session state lost

**Solution:** The orchestrator stores state in-memory. For production:

1. Store in Cloudflare KV:
```typescript
await this.env.FLOW_STATE_KV.put(sessionId, JSON.stringify(flowState), {
  expirationTtl: 3600, // 1 hour
});
```

2. Or use Durable Objects for persistent state.

### Issue: Nutrition data inaccurate

**Solution:** Integrate with USDA FoodData Central or Nutritionix API for production.

## Performance Considerations

- **Claude API Calls:** Each message = 1 API call (~$0.003 per request)
- **Prompt Caching:** Not used in orchestrator (conversation is dynamic)
- **Session Storage:** In-memory (use KV or DO for production)
- **Database Queries:** Indexed on household_id, user_id, logged_at

## Security

- ✅ All endpoints require authentication (`verifyToken` middleware)
- ✅ Household access verified for every operation
- ✅ User can only access their own households
- ✅ Soft delete preserves audit trail
- ✅ Input validation on all user-provided data

## Future Enhancements

1. **Voice Input** - Integrate with speech-to-text
2. **Barcode Scanning** - Auto-populate ingredients from product barcodes
3. **Recipe Recommendations** - AI suggests recipes based on available ingredients
4. **Meal Planning** - Weekly meal planning with shopping lists
5. **Social Sharing** - Share recipes with other households
6. **Nutrition Goals** - Track against daily goals with progress bars
7. **Recipe Collections** - Organize recipes into collections (e.g., "Quick Dinners")

## Conclusion

The Recipe Flow Orchestration System provides a conversational, AI-powered interface for recipe creation, meal logging, and water tracking. By following AI best practices (intent detection, multi-turn conversations, progressive data collection, confirmation loops), the system ensures all mandatory data is collected while maintaining a natural user experience.

**Key Benefits:**

- ✅ Natural language interface (no complex forms)
- ✅ Automatic nutrition calculation
- ✅ Smart ingredient extraction
- ✅ Cooking method detection
- ✅ Structured data collection
- ✅ Context-aware conversations
- ✅ Extensible architecture

---

**Questions?** Check the code:
- [ConversationFlowOrchestrator.ts](backend/src/services/conversation-flow-orchestrator.ts)
- [RecipeService.ts](backend/src/services/recipe-service.ts)
- [Routes](backend/src/routes/recipes.ts)
- [Schema](backend/src/db/schema.ts)
- [Migration](backend/migrations/0004_recipe_meal_water_tracking.sql)
