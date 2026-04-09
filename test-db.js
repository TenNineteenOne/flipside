require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function test() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  
  const { data: searchCache } = await supabase.from('artist_search_cache').select('spotify_artist_id, artist_name, artist_color').limit(5);
  console.log("artist_search_cache:", searchCache);

  const { data: recCache } = await supabase.from('recommendation_cache').select('spotify_artist_id, artist_data').limit(2);
  console.log("recommendation_cache colors:", recCache?.map(r => r.artist_data.artist_color));
}
test();
