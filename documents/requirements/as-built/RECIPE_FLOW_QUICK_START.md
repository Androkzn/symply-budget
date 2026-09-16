# Recipe Flow - Quick Start Guide

## 📋 What Was Built

A complete AI-powered recipe management system with:
- ✅ Conversational recipe creation (AI detects ingredients, nutrition, cooking method)
- ✅ Meal logging with automatic nutrition tracking
- ✅ Water intake logging
- ✅ Daily nutrition summaries
- ✅ Full REST API for recipe CRUD

## 🚀 Setup Instructions

### Step 1: Apply Database Migration

**Option A: Using Wrangler (requires Node v20+)**
```bash
cd backend
npm run db:migrate
```

**Option B: Using the provided script**
```bash
cd backend
./apply-recipe-migration.sh
```

**Option C: Manual SQL execution**
```bash
cd backend
wrangler d1 execute simple-house-db --local --file=./migrations/0004_recipe_meal_water_tracking.sql
```

### Step 2: Start Development Server

```bash
cd backend
npm run dev
```

### Step 3: Test the API

**Create a recipe via AI chat:**
```bash
curl -X POST http://localhost:8787/households/YOUR_HOUSEHOLD_ID/recipes/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I want to create a recipe with 2 chicken breasts, 1 cup rice, and 3 garlic cloves"
  }'
```

**Response:**
```json
{
  "response": "📋 Ingredients Detected:\n\n1. chicken breast - 2 pieces\n   🔥 165 cal | 🥩 31g protein...",
  "sessionId": "session_1737408000_abc123",
  "flowType": "create_recipe",
  "stage": "confirm_ingredients",
  "requiresUserInput": true,
  "suggestedActions": ["✅ Confirm ingredients", "✏️ Edit ingredients", "❌ Start over"]
}
```

## 📝 API Endpoints

### Recipe Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/households/:id/recipes/chat` | AI-powered conversational interface |
| POST | `/households/:id/recipes` | Create recipe manually |
| GET | `/households/:id/recipes` | List recipes (supports search, favorites) |
| GET | `/households/:id/recipes/:recipeId` | Get single recipe with ingredients |
| PATCH | `/households/:id/recipes/:recipeId` | Update recipe |
| DELETE | `/households/:id/recipes/:recipeId` | Soft delete recipe |
| POST | `/households/:id/recipes/:recipeId/favorite` | Toggle favorite |

### Meal & Water Logging

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/households/:id/meals` | Log meal consumption |
| POST | `/households/:id/water` | Log water intake |
| GET | `/households/:id/nutrition/daily/:date` | Get daily nutrition summary (YYYY-MM-DD) |

## 🤖 AI Recipe Flow

### Conversation Example

```
User: "I want to log a recipe with chicken and vegetables"
↓ [AI detects intent: create_recipe]
↓ [AI extracts ingredients and fetches nutrition]

AI: "📋 Ingredients Detected:
     1. chicken - 165 cal | 31g protein | 0g carbs | 3.6g fat
     2. vegetables - 50 cal | 2g protein | 10g carbs | 0.5g fat

     Does this look correct?"

User: "Yes"
↓ [Stage: collect_recipe_name]

AI: "Great! What would you like to name this recipe?
     Also, how long does it take to prepare and cook?"

User: "Grilled Chicken with Veggies, 10 min prep, 20 min cook"
↓ [Stage: collect_cooking_method]

AI: "Got it! Recipe: 'Grilled Chicken with Veggies'.
     How is this dish cooked? (e.g., baking, frying, grilling)"

User: "Grilling"
↓ [Stage: collect_servings]

AI: "Cooking method: Grilling. How many servings does this recipe make?"

User: "4"
↓ [Stage: finalize_recipe]
↓ [Saves to database]

AI: "✅ Recipe Created Successfully!
     📝 Grilled Chicken with Veggies
     👨‍🍳 Cooking Method: Grilling
     ⏱️ Prep: 10 min | Cook: 20 min
     🍽️ Servings: 4
     🔥 Total Calories: ~860 cal (215 per serving)

     Recipe ID: recipe_1737408000123"
```

## 🔧 Mandatory Data Collection

The AI ensures ALL required fields are collected:

1. ✅ **Ingredients** - Extracted from message or asked
2. ✅ **Nutrition** - Automatically fetched via Claude AI
3. ✅ **Recipe Name** - Asked explicitly
4. ✅ **Prep/Cook Time** - Asked with name (defaults provided if missing)
5. ✅ **Cooking Method** - Detected or defaults to "Mixed"
6. ✅ **Servings** - Asked explicitly

## 📊 Database Tables

- `recipes` - Recipe metadata
- `recipe_ingredients` - Ingredients with nutrition
- `meal_logs` - Meal consumption records
- `water_logs` - Water intake records
- `nutrition_goals` - User nutrition targets

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│  ConversationFlowOrchestrator       │
│  - Intent detection                 │
│  - Multi-stage conversation         │
│  - Data collection & validation     │
│  - AI integration (Claude)          │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  RecipeService                      │
│  - CRUD operations                  │
│  - Nutrition calculation            │
│  - Meal/water logging               │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Database (Cloudflare D1)           │
│  - recipes                          │
│  - recipe_ingredients               │
│  - meal_logs                        │
│  - water_logs                       │
└─────────────────────────────────────┘
```

## 🧪 Testing

### Test Intent Detection
```bash
curl -X POST http://localhost:8787/households/hh_123/recipes/chat \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "I want to create a recipe"}'
```

### Continue Conversation
```bash
curl -X POST http://localhost:8787/households/hh_123/recipes/chat \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "chicken, rice, garlic",
    "sessionId": "session_1737408000_abc123"
  }'
```

### Manual Recipe Creation (Skip AI)
```bash
curl -X POST http://localhost:8787/households/hh_123/recipes \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Recipe",
    "servings": 4,
    "preparationTime": 15,
    "cookingTime": 30,
    "ingredients": [
      {
        "name": "chicken",
        "quantity": 2,
        "unit": "pieces",
        "nutrition": {
          "calories": 165,
          "protein": 31,
          "carbs": 0,
          "fat": 3.6
        }
      }
    ]
  }'
```

## 🔐 Security

- ✅ All endpoints require authentication (`authMiddleware`)
- ✅ Household access verified for every operation
- ✅ Users can only access their own household data
- ✅ Soft delete preserves audit trail

## 📚 Files Created

### Backend Services
- [`conversation-flow-orchestrator.ts`](backend/src/services/conversation-flow-orchestrator.ts) - Main AI orchestration
- [`recipe-service.ts`](backend/src/services/recipe-service.ts) - Database operations

### Routes
- [`recipes.ts`](backend/src/routes/recipes.ts) - API endpoints

### Database
- [`schema.ts`](backend/src/db/schema.ts) - Updated with recipe tables
- [`0004_recipe_meal_water_tracking.sql`](backend/migrations/0004_recipe_meal_water_tracking.sql) - Migration

### Documentation
- [`RECIPE_FLOW_GUIDE.md`](RECIPE_FLOW_GUIDE.md) - Comprehensive guide
- [`RECIPE_FLOW_QUICK_START.md`](RECIPE_FLOW_QUICK_START.md) - This file

## 🎯 Next Steps

1. **Apply Migration**
   ```bash
   cd backend
   ./apply-recipe-migration.sh
   ```

2. **Start Server**
   ```bash
   npm run dev
   ```

3. **Test the Flow**
   - Use the curl examples above
   - Or integrate with your frontend chat component

4. **Frontend Integration** (Example)
   ```typescript
   const ChatComponent = () => {
     const [sessionId, setSessionId] = useState<string>();
     const [messages, setMessages] = useState([]);

     const sendMessage = async (text: string) => {
       const res = await fetch(`/households/${id}/recipes/chat`, {
         method: 'POST',
         headers: { Authorization: `Bearer ${token}` },
         body: JSON.stringify({ message: text, sessionId }),
       });

       const data = await res.json();
       setSessionId(data.sessionId);
       setMessages([...messages,
         { role: 'user', content: text },
         { role: 'assistant', content: data.response }
       ]);

       // Show suggested actions as buttons
       if (data.suggestedActions) {
         showQuickReplies(data.suggestedActions);
       }
     };
   };
   ```

## ⚙️ Configuration

Ensure `ANTHROPIC_API_KEY` is set in your `wrangler.toml`:

```toml
[vars]
ANTHROPIC_API_KEY = "sk-ant-..."
```

## 🐛 Troubleshooting

**Migration fails with Node version error:**
- Solution: Upgrade to Node v20+ or use the manual SQL execution method

**AI not detecting ingredients:**
- Solution: Use comma-separated format: "2 chicken breasts, 1 cup rice, 3 garlic cloves"

**Session state lost:**
- This is expected - sessions are stored in-memory
- For production, migrate to Cloudflare KV or Durable Objects

**Nutrition data seems inaccurate:**
- The system uses Claude AI for estimates
- For production, integrate USDA FoodData Central API or Nutritionix

## 📖 Full Documentation

See [RECIPE_FLOW_GUIDE.md](RECIPE_FLOW_GUIDE.md) for:
- Detailed architecture explanation
- AI best practices applied
- Extension guide
- Production deployment tips

---

**Questions?** Check the comprehensive guide or review the source code in [`backend/src/services/`](backend/src/services/)
