-- Business plan: travel costs get their own fixed-charge line (trains,
-- flights, hotels, taxis, fuel, tolls, parking), matching account 6251.
alter type public.fixed_charge_line add value if not exists 'deplacements' before 'divers';
