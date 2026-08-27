use std::collections::{HashMap, HashSet, VecDeque};

/// Returns the way IDs in the largest connected component of a road graph.
///
/// Ways are connected when they share an OSM node. Keeping the operation on
/// IDs lets the compiler preserve the complete source way metadata while the
/// topology adapter evolves.
pub(crate) fn largest_connected_component(
    way_nodes: &HashMap<i64, Vec<i64>>,
) -> HashSet<i64> {
    let mut node_ways = HashMap::<i64, Vec<i64>>::new();
    for (way_id, nodes) in way_nodes {
        for node_id in nodes {
            node_ways.entry(*node_id).or_default().push(*way_id);
        }
    }

    let mut unvisited: HashSet<i64> = way_nodes.keys().copied().collect();
    let mut largest = HashSet::new();
    while let Some(start) = unvisited.iter().next().copied() {
        let mut component = HashSet::new();
        let mut queue = VecDeque::from([start]);
        unvisited.remove(&start);
        while let Some(way_id) = queue.pop_front() {
            component.insert(way_id);
            for node_id in way_nodes.get(&way_id).into_iter().flatten() {
                for neighbor in node_ways.get(node_id).into_iter().flatten() {
                    if unvisited.remove(neighbor) {
                        queue.push_back(*neighbor);
                    }
                }
            }
        }
        let component_min_id = component.iter().min().copied();
        let largest_min_id = largest.iter().min().copied();
        if component.len() > largest.len()
            || (component.len() == largest.len()
                && component_min_id < largest_min_id)
        {
            largest = component;
        }
    }
    largest
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excludes_disconnected_ways_while_retaining_shared_node_networks() {
        let ways = HashMap::from([
            (10, vec![1, 2]),
            (11, vec![2, 3]),
            (12, vec![40, 41]),
        ]);

        assert_eq!(
            largest_connected_component(&ways),
            HashSet::from([10, 11])
        );
    }

    #[test]
    fn an_empty_graph_has_no_component() {
        assert!(largest_connected_component(&HashMap::new()).is_empty());
    }
}